#!/usr/bin/env bash
# Vercel Ignored Build Step.
# Exit 0 → proceed with build. Exit 1 → skip build (docs-only change).
set -euo pipefail

if ! git rev-parse --verify HEAD^ >/dev/null 2>&1; then
  exit 0
fi

CHANGED=$(git diff --name-only HEAD^ HEAD -- || true)
if [ -z "$CHANGED" ]; then
  exit 0
fi

echo "$CHANGED" | while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *.md|docs|docs/*|reports|reports/*|analysis|analysis/*|*.canvas.tsx) ;;
    *) exit 0 ;; # real change → build (exits the while subshell!)
  esac
done
# The while runs in a subshell — detect via a flag file instead:
needs_build=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *.md|docs|docs/*|reports|reports/*|analysis|analysis/*|*.canvas.tsx) ;;
    *) needs_build=1; break ;;
  esac
done <<LIST
$CHANGED
LIST

if [ "$needs_build" -eq 1 ]; then
  exit 0
fi
echo "Ignored build: only docs/markdown/analysis files changed"
exit 1
