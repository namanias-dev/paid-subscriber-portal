#!/usr/bin/env bash
# Vercel Ignored Build Step.
# Exit 0 → proceed with build. Exit 1 → skip build (docs-only change).
#
# Do NOT use `case … esac` here: paths like app/(site)/… contain `)` which
# terminates case patterns early and falsely skips real code builds.
set -euo pipefail

if ! git rev-parse --verify HEAD^ >/dev/null 2>&1; then
  exit 0
fi

CHANGED=$(git diff --name-only HEAD^ HEAD -- || true)
if [ -z "$CHANGED" ]; then
  exit 0
fi

needs_build=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [[ "$f" == *.md \
     || "$f" == docs \
     || "$f" == docs/* \
     || "$f" == reports \
     || "$f" == reports/* \
     || "$f" == analysis \
     || "$f" == analysis/* \
     || "$f" == *.canvas.tsx ]]; then
    continue
  fi
  needs_build=1
  break
done <<LIST
$CHANGED
LIST

if [ "$needs_build" -eq 1 ]; then
  exit 0
fi
echo "Ignored build: only docs/markdown/analysis files changed"
exit 1
