#!/usr/bin/env bash
# Crew Call backup: the database every run, the settings file (.env) every run, and uploaded
# files (media, .pro files) once a week. Copies go to BACKUP_DEST, usually a NAS folder.
#
#   scripts/backup.sh          back up now (run it from cron nightly; see README → Backups)
#   scripts/backup.sh --check  only check that everything is ready, write nothing
#
# Settings, read from .env (all optional):
#   BACKUP_DEST=/mnt/crewcall-backups   where backups go (default: ./backups next to this app)
#   BACKUP_KEEP_DAYS=30                 delete backups older than this (default 30)
#   BACKUP_UPLOADS=weekly               weekly (Mondays) | daily | off
#
# A NAS folder must contain an empty file named .crewcall-backups, so a backup never fills the
# server's own disk when the NAS isn't mounted.
set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR=$(pwd)
CHECK=false
[ "${1:-}" = "--check" ] && CHECK=true

say() { printf '%s  %s\n' "$(date '+%F %T')" "$*"; }
fail() { say "BACKUP FAILED: $*"; exit 1; }

setting() { # value of KEY in .env, without quotes
  [ -f .env ] || return 0
  grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d "\"'" || true
}

DEST=$(setting BACKUP_DEST)
KEEP=$(setting BACKUP_KEEP_DAYS)
UPLOADS=$(setting BACKUP_UPLOADS)
DEST=${DEST:-$APP_DIR/backups}
KEEP=${KEEP:-30}
UPLOADS=${UPLOADS:-weekly}
case "$KEEP" in '' | *[!0-9]*) fail "BACKUP_KEEP_DAYS must be a number of days." ;; esac

COMPOSE=(docker compose -f docker-compose.yml)
[ -f compose.override.yaml ] && COMPOSE+=(-f compose.override.yaml)
[ -f compose.override.yml ] && COMPOSE+=(-f compose.override.yml)

# ---- checks ----
[ -f .env ] || fail "No .env file in $APP_DIR."
if [ "$DEST" != "$APP_DIR/backups" ]; then
  [ -d "$DEST" ] || fail "$DEST doesn't exist. Is the NAS mounted?"
  [ -f "$DEST/.crewcall-backups" ] || fail "$DEST/.crewcall-backups is missing. Is the NAS mounted? (Create the file once the share is mounted.)"
fi
mkdir -p "$DEST" 2>/dev/null || true
[ -w "$DEST" ] || fail "Can't write to $DEST. Fix with: sudo chown -R $(id -un): \"$DEST\""
"${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx mongo || fail "The database container isn't running."
if $CHECK; then
  say "Ready: backups go to $DEST, kept $KEEP days, uploads $UPLOADS."
  exit 0
fi

STAMP=$(date +%F-%H%M)
DB="$DEST/crewcall-db-$STAMP.gz"
ENVCOPY="$DEST/crewcall-env-$STAMP.txt"
FILES="$DEST/crewcall-uploads-$STAMP.tgz"

# ---- database ----
say "Backing up the database to $DB"
"${COMPOSE[@]}" exec -T mongo sh -c 'mongodump --quiet --archive --gzip -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db crewcall' >"$DB.part" ||
  { rm -f "$DB.part"; fail "mongodump didn't work (check the database password in .env)."; }
[ "$(wc -c <"$DB.part")" -gt 200 ] || { rm -f "$DB.part"; fail "The database backup came out empty."; }
mv "$DB.part" "$DB"

# ---- settings (.env holds passwords: readable only by you) ----
(umask 077 && cp .env "$ENVCOPY")
say "Saved a copy of .env"

# ---- uploaded files ----
if [ "$UPLOADS" = daily ] || { [ "$UPLOADS" = weekly ] && [ "$(date +%u)" = 1 ]; }; then
  say "Backing up uploaded files to $FILES (this can take a while)"
  "${COMPOSE[@]}" exec -T api tar czf - -C /data/uploads . >"$FILES.part" ||
    { rm -f "$FILES.part"; fail "Couldn't read the uploaded files."; }
  mv "$FILES.part" "$FILES"
fi

# ---- tidy up ----
find "$DEST" -maxdepth 1 -type f \( -name 'crewcall-db-*.gz' -o -name 'crewcall-env-*.txt' -o -name 'crewcall-uploads-*.tgz' \) -mtime +"$KEEP" -delete
say "Done. $(find "$DEST" -maxdepth 1 -name 'crewcall-db-*.gz' | wc -l | tr -d ' ') database backups kept in $DEST ($(du -sh "$DEST" 2>/dev/null | cut -f1))."
printf '%s ok %s\n' "$(date '+%F %T')" "$DB" >"$DEST/last-backup.txt"
