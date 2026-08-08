#!/usr/bin/env bash
# Exit 0 = build, Exit 1 = skip (docs/md/reports/analysis only).
set -u
git rev-parse --verify HEAD^ >/dev/null 2>&1 || exit 0
git diff --quiet HEAD^ HEAD -- \
  . \
  ':(exclude)*.md' \
  ':(exclude)docs/**' \
  ':(exclude)reports/**' \
  ':(exclude)analysis/**' \
  && exit 1 || exit 0
