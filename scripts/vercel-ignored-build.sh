#!/usr/bin/env bash
# Vercel Ignored Build Step — wired from vercel.json `ignoreCommand` only.
# Do NOT set a dashboard "Ignored Build Step" (that field was previously inverted
# and canceled every real production deploy).
#
# Exit-code convention (Vercel official — DO NOT INVERT):
#   exit 0  → SKIP the build (cancel / no deployment)
#   exit 1  → PROCEED with the build
#
# Skip only when EVERY changed file is docs-like (*.md, docs/**, analysis/**, *.xlsx).
# Always proceed if the diff touches app/, components/, lib/, api/, vercel.json,
# package.json, or lockfiles — including paths with parentheses like app/(site)/….
# Use [[ ]] glob matches (never case/esac): ')' in paths breaks case patterns.
# Avoid bash process-substitution (< <(...)) — it breaks on Vercel’s build image.

set -u

resolve_before() {
  # Prefer Vercel’s previous SHA when the object exists in the clone.
  if [ -n "${VERCEL_GIT_PREVIOUS_SHA:-}" ] && git cat-file -e "${VERCEL_GIT_PREVIOUS_SHA}^{commit}" 2>/dev/null; then
    printf '%s\n' "$VERCEL_GIT_PREVIOUS_SHA"
    return 0
  fi
  if git rev-parse --verify HEAD^ >/dev/null 2>&1; then
    git rev-parse HEAD^
    return 0
  fi
  # Shallow clone: deepen enough to see the parent commit.
  git fetch --deepen=10 >/dev/null 2>&1 || true
  if git rev-parse --verify HEAD^ >/dev/null 2>&1; then
    git rev-parse HEAD^
    return 0
  fi
  return 1
}

before="$(resolve_before || true)"
if [ -z "${before:-}" ]; then
  echo "ignored-build: no parent SHA — proceed (exit 1)"
  exit 1
fi

echo "ignored-build: diff ${before}..HEAD"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
# Quoted pathspecs not needed for name-only; -z keeps parentheses/spaces safe.
git diff --name-only -z "$before" HEAD -- >"$tmp" || true

changed=()
while IFS= read -r -d '' f; do
  [ -n "$f" ] && changed+=("$f")
done <"$tmp"

if [ "${#changed[@]}" -eq 0 ]; then
  echo "ignored-build: empty diff — proceed (exit 1)"
  exit 1
fi

is_must_build() {
  local f="$1"
  [[ "$f" == app || "$f" == app/* ]] && return 0
  [[ "$f" == components || "$f" == components/* ]] && return 0
  [[ "$f" == lib || "$f" == lib/* ]] && return 0
  [[ "$f" == api || "$f" == api/* ]] && return 0
  [[ "$f" == vercel.json ]] && return 0
  [[ "$f" == package.json ]] && return 0
  [[ "$f" == package-lock.json || "$f" == yarn.lock || "$f" == pnpm-lock.yaml || "$f" == bun.lockb || "$f" == bun.lock ]] && return 0
  return 1
}

is_docs_only_path() {
  local f="$1"
  [[ "$f" == *.md ]] && return 0
  [[ "$f" == docs || "$f" == docs/* ]] && return 0
  [[ "$f" == analysis || "$f" == analysis/* ]] && return 0
  [[ "$f" == *.xlsx ]] && return 0
  return 1
}

echo "ignored-build: changed files:"
for f in "${changed[@]}"; do
  echo "  - $f"
  if is_must_build "$f"; then
    echo "ignored-build: must-build path → proceed (exit 1)"
    exit 1
  fi
  if ! is_docs_only_path "$f"; then
    echo "ignored-build: non-docs path → proceed (exit 1)"
    exit 1
  fi
done

echo "ignored-build: all changes are docs/md/xlsx → skip (exit 0)"
exit 0
