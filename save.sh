#!/usr/bin/env bash
# Save this app's changes and upload them to GitHub.
# Usage:  ./save.sh "what you changed"     (message is optional)
set -euo pipefail
cd "$(dirname "$0")"

msg="${1:-Update from OptiPlex $(date '+%Y-%m-%d %H:%M')}"
git add -A

# Safety check: never upload .env files (except the blank .env.example)
bad=$(git diff --cached --name-only | grep -E '(^|/)\.env' | grep -v '\.env\.example$' || true)
if [ -n "$bad" ]; then
  echo "STOPPED - these secret files were about to be uploaded:"
  echo "$bad"
  git reset -q
  exit 1
fi

if git diff --cached --quiet; then
  echo "Nothing new to save."
  exit 0
fi

git commit -q -m "$msg"
git push -q
echo "Saved and pushed: $msg"
