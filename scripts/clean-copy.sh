#!/usr/bin/env bash
# Makes the clean copy of Crew Call that can be given to other organizations: the whole app,
# without anything about our own servers. No people, schedules or chats are ever in the code
# (they live in the database), so a fresh install starts empty with its own first admin.
#
#   scripts/clean-copy.sh OUT_DIR        writes the clean copy to OUT_DIR
#   scripts/clean-copy.sh OUT_DIR --zip  also makes OUT_DIR.zip to hand over
#
# GitHub runs this on every push to main and keeps the "clean" branch up to date
# (.github/workflows/clean-copy.yml).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:?usage: scripts/clean-copy.sh OUT_DIR [--zip]}
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT" ;; esac

rm -rf "$OUT"
mkdir -p "$OUT"
git archive HEAD | tar -x -C "$OUT"
cd "$OUT"

# Our own servers and tools: shipping to the church box, saving from the home server
rm -rf .github save.sh scripts/ship.sh scripts/clean-copy.sh
find . -name state.json -delete # leftover tool files, not part of the app

# Our names and sites in examples
grep -rIl -e 'practiceav\.fyi' -e 'Hub renamed' -e 'Hub is editing' -e '/srv/stacks/org/crew-call' . | xargs -r sed -i \
  -e 's/practiceav\.fyi/academy.example.org/g' \
  -e 's#/srv/stacks/org/crew-call#/opt/crew-call#g' \
  -e 's/Hub renamed/Sam renamed/g' \
  -e 's/Hub is editing/Sam is editing/g'

cat > CLEAN-COPY.md <<'TXT'
# About this copy

This is a clean copy of Crew Call, ready for a new organization. It has no people, schedules,
chats or settings in it: those live in the database, which starts empty.

To set it up, follow **README.md → 1. First start**. The first person to open the site creates
the organization and becomes its admin, then adds everyone else from Team & roles.
TXT

# Stop if anything of ours is still in it
if grep -rIn -i -e 'impact church' -e 'sched-mas' -e 'church-signage' -e 'impactchurch' -e '100\.88\.' \
  -e 'optiplex' -e 'maitland' -e 'hubertmusic' -e 'practiceav' -e '/srv/stacks' -e '/srv/appdata' .; then
  echo "STOPPED: the lines above still mention our church or servers. Fix them in main, or add them to scripts/clean-copy.sh."
  exit 1
fi

if [ "${2:-}" = "--zip" ]; then
  rm -f "$OUT.zip"
  (cd "$(dirname "$OUT")" && zip -qr "$OUT.zip" "$(basename "$OUT")")
  echo "Clean copy: $OUT  (and $OUT.zip)"
else
  echo "Clean copy: $OUT"
fi
