#!/usr/bin/env bash
# Intended: skip builds when ONLY *.md / docs/** / reports/** / analysis/** change.
# Vercel git pathspec diffs were returning empty and canceling real builds; until
# that is root-caused, callers should use `exit 0` (always build). Re-enable:
#   git diff --quiet HEAD^ HEAD -- . ':(exclude)*.md' ':(exclude)docs/**' \
#     ':(exclude)reports/**' ':(exclude)analysis/**' && exit 1 || exit 0
exit 0
