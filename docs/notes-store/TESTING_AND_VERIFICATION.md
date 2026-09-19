# Notes Store — testing and verification

## Commands (lockfile / package scripts)

```bash
npx tsc --noEmit
node scripts/ci/guard-store-domain-isolation.mjs
node --import tsx --import ./scripts/_react-cache-shim.mjs --test \
  tests/notes-store-isolation/*.test.ts \
  tests/notes-store-media/*.test.ts
```

Optional preview smoke (no charge; requires Vercel auth):

```bash
npx vercel env run -e development -- node scripts/notes-preview-smoke.mjs <preview-origin>
```

`npm test` includes store isolation + media suites among many others.

## Test files

| File | Covers |
|------|--------|
| `tests/notes-store-isolation/import-guardrail.test.ts` | Forbidden imports/tables; STORE_DIRS |
| `tests/notes-store-isolation/callback-shim.test.ts` | Shared return URL dispatch vs course |
| `tests/notes-store-isolation/references-and-status.test.ts` | `NIASN-N-`, status mapping |
| `tests/notes-store-isolation/preview-flag.test.ts` | Preview enable vs production |
| `tests/notes-store-isolation/serviceability.test.ts` | PIN buffer; Packed→preparing |
| `tests/notes-store-isolation/access-token.test.ts` | Entropy, hash, redact, cookie bind |
| `tests/notes-store-media/watermark.test.ts` | Sharp watermark; no original_key leak |

Inventory concurrency: covered by inventory RPC design + historical commit `ed1d5a9e`; re-run any dedicated concurrency script if present under `scripts/` before claiming.

## Handoff-day results (2026-09-19)

| Check | Result |
|-------|--------|
| Isolation + media + access-token | **53 pass / 0 fail** |
| Domain isolation guard | **OK** |
| `tsc --noEmit` | **clean** |
| Production build | Run on release branch earlier same day — **succeeded** (`next build` exit 0) |
| Lint (`next lint`) | **Not configured** (no `.eslintrc`; interactive prompt) — record as N/A |
| Playwright | **Absent** |
| Real Eazypay | **Deferred by owner — not tested** |
| Lighthouse on preview | Hit Vercel SSO login — **invalid as store scores; do not cite** |

## How to get valid Lighthouse later

Run against **local** `next start` with preview enable, or an **unauthenticated** preview bypass the owner explicitly configures — never treat SSO login scores as store metrics.

## Deferred real-payment checklist (do not nag)

Preserved for owner-initiated later run: NIASN-N- ref, advisory callback, Verify once, inventory once, zero Academy identity/payment rows, token access, admin fulfil, idempotent replay. See historical Stage 8 list in agent transcripts if needed — **not passed**.
