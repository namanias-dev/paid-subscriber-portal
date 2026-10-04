# Production release

How a change reaches namanias.com and how to back it out. No secrets in this file.

## Linked services

| Service | Identity | Role |
|---|---|---|
| GitHub | `namanias-dev/paid-subscriber-portal` | Source. Every pushed branch gets a Vercel Preview. |
| Vercel | team `naman-ias-academy`, project `naman-ias` (`prj_ULEGPguZAXU3V5nk8ZiZ9RWkqfFE`), region `bom1` | Hosting. Production domains `namanias.com`, `www.namanias.com`. Previews sit behind Vercel Authentication. |
| Supabase | project `xqwdfyzerzsllqiyzxem` (South Asia, Mumbai) | Production Postgres. Migrations in `supabase/migrations/` are applied by hand in the SQL editor. They must be additive. |
| Cloudflare R2 | Store media, labels and invoice PDFs (`lib/store/media/**`, `lib/store/invoice/**`) | Smoke tests never write, overwrite or delete objects. |

Production is **not** a branch. Vercel serves whichever deployment was promoted last, and branches drift (production has run from `cursor/*-d465` branches while `master` held other work). `/api/version` is the source of truth for the live commit.

## Logins (interactive, once per machine)

```bash
gh auth login          # GitHub
vercel login           # device flow; then: vercel link --yes --scope naman-ias-academy --project naman-ias
supabase login         # browser + verification code
wrangler login         # Cloudflare, only when R2 work needs it
```

`vercel link` writes `.vercel/` (gitignored) and may pull a `.env.local`. Move `.env.local` out of the repo: with a Supabase URL present the app and tests leave demo mode and talk to production. `vercel env pull` returns placeholders for sensitive values, so it cannot be used to reach the database.

## Sequence

1. **Start from live.** `curl https://www.namanias.com/api/version`, then branch from that SHA. Do not start from `master`. Classify master-only commits (already live / this task / unrelated / stale) and do not merge unrelated work into a feature release.
2. **Check.** `npm run release:check` confirms:
   - the candidate contains the live SHA,
   - no live `app/`, `lib/`, `components/` or migration files are deleted,
   - no production write overrides are set,
   - typecheck, tests and build pass.
   Compare failing tests against the same command on the live SHA. Only identical baseline failures may remain.
3. **Migrations.** Apply additive SQL to production before promoting, so the new code never runs against an old schema. Never run a destructive or down migration automatically.
4. **Preview.** Push the branch. Vercel builds a Preview. Then run `npm run release:smoke -- <preview url>`.
5. **Production.** `npm run release:prod -- <preview url>` records the current production deployment as the rollback target, promotes the tested preview, waits for `/api/version` to show the candidate SHA, smokes public and admin routes, and reads error-level runtime logs. On failure it rolls back automatically. Promotion rebuilds the same commit with production env vars.
6. **Verify any time.** `npm run release:verify -- <sha>`. Add feature routes with `RELEASE_ROUTES="/a,/b"`.
7. **Data releases.** `npm run release:verify-data -- notes-analytics [30d]` reads production through the logged-in Supabase CLI (`supabase db query --linked`). It never uses the service-role key. It runs only allowlisted single `SELECT` statements, rejects mutation keywords, wraps each statement in `begin transaction read only … rollback`, and refuses to start while a write override is set. It feeds the rows into the same pure functions the dashboard uses, then asserts invariants: cumulative = KPIs, state and subject totals reconcile, no NaN, no silent event cap. It exits 1 on any failure. Add a new suite to `scripts/release/verify-data.ts` for each data-heavy feature.
8. **Rollback by hand.** `npm run release:rollback -- <deployment id>` runs `vercel rollback`, which is instant and does not rebuild. Additive migrations stay in place; the previous app ignores them.

## Write guards (already in the codebase)

- No Supabase env means demo mode: mock data, simulated payments. `npm test` must run this way.
- `ALLOW_TEST_DB_WRITES=1` is the only way test-record creation runs against live data (`lib/testRecordGuard.ts`).
- Courier label, AWB and pickup writes need both `NOTES_STORE_SHIPPING_WRITES=1` and `NOTES_STORE_SHIPPING_WRITE_CONFIRM` (`lib/store/shipping/config.ts`).
- `scripts/release/release.mjs` only issues GET requests. It never submits checkout, Pay, Verify, refunds, courier bookings or R2 writes, and it refuses to run checks while a write override is set.

## Critical production invariants

- One legitimate captured transaction gives one paid order. Duplicate callbacks never double-capture. `applyStoreVerify` is the only terminal authority, and the ICICI merchant amount (not the card total) is compared.
- A captured Notes order has exactly one invoice (`claim_store_invoice`).
- One order has at most one active shipment/AWB. Packed never auto-books a courier, and manual booking uses only the courier staff selected.
- The package shown on screen comes from the same resolver used for booking.
- Analytics revenue counts only captured, non-QA orders. Behaviour metrics are first-party sessions.
- Notes Store money never enters academy `payments` (`scripts/ci/guard-store-domain-isolation.mjs`).
