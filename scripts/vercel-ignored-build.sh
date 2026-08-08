#!/usr/bin/env bash
# Vercel Ignored Build Step.
# Exit 0 → proceed with build. Exit 1 → skip build (docs-only change).
#
# Uses git pathspec excludes (not case/esac) so paths like app/(site)/… work.
set -u

if ! git rev-parse --verify HEAD^ >/dev/null 2>&1; then
  exit 0
fi

# Exit 0 from --quiet ⇒ no non-docs changes ⇒ skip build.
# Exit 1 from --quiet ⇒ there are code/config changes ⇒ build.
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
  echo "Ignored build: only docs/markdown/analysis files changed"
  exit 1
fi

exit 0
