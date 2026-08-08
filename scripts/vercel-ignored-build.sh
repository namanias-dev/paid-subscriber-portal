#!/usr/bin/env bash
# Vercel Ignored Build Step. Exit 0 = build, Exit 1 = skip.
# Skip only when every changed file is md / docs / reports / analysis.
set -u
[ "${VERCEL_ENV:-}" = production ] || exit 0
git rev-parse --verify HEAD^ >/dev/null 2>&1 || exit 0
if git diff --quiet HEAD^ HEAD -- \
  . \
  ':(exclude)*.md' \
  ':(exclude)docs' \
  ':(exclude)docs/**' \
  ':(exclude)reports' \
  ':(exclude)reports/**' \
  ':(exclude)analysis' \
  ':(exclude)analysis/**' \
  ':(exclude)*.canvas.tsx'
then
  echo "Ignored build: docs/markdown/analysis only"
  exit 1
fi
exit 0
