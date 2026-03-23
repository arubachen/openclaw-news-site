#!/usr/bin/env bash
set -euo pipefail

SITE_DIR="/Users/arubachen/.openclaw/workspace/news-site"
cd "$SITE_DIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo '{"ok":false,"reason":"not-a-git-repo"}'
  exit 1
fi

npm run validate >/dev/null

if [[ -z "$(git status --porcelain)" ]]; then
  echo '{"ok":true,"changed":false,"message":"no changes"}'
  exit 0
fi

git add .
if git diff --cached --quiet; then
  echo '{"ok":true,"changed":false,"message":"nothing staged"}'
  exit 0
fi

stamp="$(date '+%Y-%m-%d %H:%M:%S %z')"
git commit -m "chore: sync news-site content (${stamp})" >/dev/null
git push origin main >/dev/null

echo '{"ok":true,"changed":true,"message":"published"}'
