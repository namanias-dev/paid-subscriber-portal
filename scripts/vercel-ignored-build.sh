#!/usr/bin/env bash
# Vercel Ignored Build Step. Exit 0 = build, Exit 1 = skip.
set -u
[ "${VERCEL_ENV:-}" = production ] || exit 0
if ! git rev-parse --verify HEAD^ >/dev/null 2>&1; then
  exit 0
fi

echo "ignore-debug changed:"
git diff --name-only HEAD^ HEAD -- || true

# Build unless the ONLY changes are docs/markdown/analysis.
non_docs=$(git diff --name-only HEAD^ HEAD -- \
  . \
  ':(exclude)*.md' \
  ':(exclude)docs' \
  ':(exclude)docs/**' \
  ':(exclude)reports' \
  ':(exclude)reports/**' \
  ':(exclude)analysis' \
  ':(exclude)analysis/**' \
  ':(exclude)*.canvas.tsx' \
  || true)

echo "ignore-debug non_docs:"
echo "$non_docs"

if [ -z "$(echo "$non_docs" | tr -d '[:space:]')" ]; then
  echo "Ignored build: docs/markdown/analysis only"
  exit 1
fi
exit 0
