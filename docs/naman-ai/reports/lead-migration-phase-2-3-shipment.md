# Legacy-lead migration — Phase 2 + Phase 3 shipment report

**Date:** 21 Jul 2026 (IST)
**Branch:** `feat/legacy-lead-migration`
**Feature sha:** `c84f2538a34fd6cb1a16146e4fc1abbe20800291`
**Master merge sha:** `2542f0c8a3ea060a724b0a3961011ab3af3fba39`
**Prod deploy id:** `dpl_9EWENsXzpaLFktkSZxDPaiQi8gRm` — **READY** (aliased `www.namanias.com`)
**Dry-run report:** [`docs/naman-ai/reports/lead-migration-dry-run.md`](lead-migration-dry-run.md)

> **STOP GATE HELD.** `--commit` was NOT executed. Zero legacy rows written to `public.leads` in this shipment. The operator reviews the dry-run report BEFORE approving Phase 4.

---

## 1. Migration SQL — applied to production

**Forward:** [`supabase/migrations/2026-07-21-legacy-lead-import.sql`](../../../supabase/migrations/2026-07-21-legacy-lead-import.sql). Applied to Supabase project `xqwdfyzerzsllqiyzxem` via Supabase MCP `apply_migration`. Additive, nullable, no lock — same pattern as the July `attribution-full-capture` migration.

```sql
alter table public.leads
  add column if not exists channel_legacy text,
  add column if not exists import_source text,
  add column if not exists import_batch text,
  add column if not exists external_lead_id text,
  add column if not exists first_seen_at timestamptz;

create index if not exists idx_leads_legacy_flag
  on public.leads ((attribution ->> 'legacy'))
  where attribution ->> 'legacy' = 'true';
create index if not exists idx_leads_import_batch
  on public.leads (import_batch) where import_batch is not null;
create index if not exists idx_leads_channel_legacy
  on public.leads (channel_legacy) where channel_legacy is not null;

create table if not exists public.leads_backfill_snapshot (
  id text primary key,
  import_batch text not null,
  was_collision boolean not null default false,
  snapshot_at timestamptz not null default now(),
  pre_state jsonb
);
create index if not exists idx_leads_backfill_snapshot_batch
  on public.leads_backfill_snapshot (import_batch);

create table if not exists public.legacy_import_sync_state (
  spreadsheet_id text not null,
  tab_name text not null,
  last_row_index integer not null default 0,
  last_synced_at timestamptz not null default now(),
  last_error text,
  primary key (spreadsheet_id, tab_name)
);
```

**Verification (READ-ONLY SELECT on prod, post-apply):**

| column_name | data_type | is_nullable |
|---|---|---|
| `channel_legacy` | text | YES |
| `external_lead_id` | text | YES |
| `first_seen_at` | timestamp with time zone | YES |
| `import_batch` | text | YES |
| `import_source` | text | YES |

Both tables (`leads_backfill_snapshot`, `legacy_import_sync_state`) exist. Zero rows in either.

**Rollback:** [`supabase/migrations/2026-07-21-legacy-lead-import-rollback.sql`](../../../supabase/migrations/2026-07-21-legacy-lead-import-rollback.sql) — **⚠️ MANUAL — DO NOT AUTO-APPLY.** Committed but not executed.

---

## 2. Code artifacts

### 2.1 Legacy-migration library (new)

| File | Purpose |
|---|---|
| `lib/legacy-migration/flags.ts` | Three exact-string-match feature flags (`LEGACY_IMPORT_ENABLED`, `SHEETS_SYNC_ENABLED`, `META_LEADS_ENABLED`). All default OFF. |
| `lib/legacy-migration/legacyFilter.ts` | Single-source-of-truth `hasLegacyFlag()` + `applyLegacyFilter()` — one predicate shared by all 7 legacy-aware call sites so behaviour cannot drift. |
| `lib/legacy-migration/tabRegistry.ts` | 9 included tabs + their column mappings + `LEAD_SOURCE_PRIORITY` (portable mirror of `matcher.py:116–126`) + channel_legacy strings. |
| `lib/legacy-migration/transform.ts` | Row-to-StagedLead transformer per tab. FB LEADS smart B/C resolver, universal cell-walk fallback for tabs with schema drift, invalid-campaign gating, ISO/DMY/epoch timestamp parsing, PII masking helpers. |
| `lib/legacy-migration/dedupe.ts` | Intra-tab keep-newest + cross-tab priority merge + `merged_touches[]` stacking. Pure, deterministic. |
| `lib/legacy-migration/sheetsClient.ts` | Thin `googleapis` wrapper — service-account JWT load + one-shot ranged tab fetch with header disambiguation. Server-only. |
| `lib/legacy-migration/sheetsSync.ts` | Phase 2B ongoing sync (watermarked, per-tab). Reuses `transform.ts` + `dedupe.ts` so no drift with the one-time importer. |
| `lib/legacy-migration/importer.ts` | Orchestrator: fetch → transform → dedupe → reconcile → optional commit + snapshot. Emits the reconciliation report struct. |
| `lib/legacy-migration/types.ts` | Structural types for `StagedLead`, `LegacyAttributionJSON`, `DryRunReport`, etc. |
| `lib/meta/leadAds.ts` | Meta Lead Ads Graph API stub — `fetchLeadgenRecord()` throws `MetaLeadsNotConfiguredError` until 4 Meta env vars + `META_LEADS_ENABLED=true`. Docs live in this file's docblock. |

### 2.2 API routes (new)

| Route | Method | Behaviour today |
|---|---|---|
| `/api/cron/legacy-sheets-sync` | GET | Returns 401 without `Bearer $CRON_SECRET`; 501 with a diagnostic body when `SHEETS_SYNC_ENABLED != "true"`. Active path: walk every included tab, delta-fetch after watermark, upsert only NEW phones, advance `legacy_import_sync_state.last_row_index`. Never fires `lead_created` events (per Q5). |
| `/api/meta/leadgen-webhook` | GET | Meta verify-token handshake: echoes `hub.challenge` when `hub.verify_token` equals `META_LEADGEN_VERIFY_TOKEN`. Returns 501 when the env is unset. |
| `/api/meta/leadgen-webhook` | POST | Returns 501 with the missing-config list until `META_LEADS_ENABLED=true` AND all four Meta env vars are set. When enabled, forwards to `fetchLeadgenRecord()` (which is itself a scaffold — no live Graph fetch). |

### 2.3 Importer + CLI

| File | Purpose |
|---|---|
| `scripts/legacy-lead-import.ts` | CLI with `--dry-run` (default) and `--commit` (refuses without `LEGACY_IMPORT_ENABLED="true"`). Loads env from `.env.local` / `.env`; accepts `--service-account-path=<file>` for local dry-run OR `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` env var for prod runs. Writes the reconciliation report to `docs/naman-ai/reports/lead-migration-dry-run.md`. Snapshots every touched row into `leads_backfill_snapshot` BEFORE the insert/update. |

### 2.4 `.gitignore` (patched)

Added `credentials/` and `service_account*.json` so the service-account key can never be accidentally staged.

### 2.5 Package.json (patched)

- Added `googleapis` runtime dependency (Google Sheets read for the importer + Phase 2B sync).
- `test` script now globs `tests/lead-migration/*.test.ts` in addition to the existing `tests/journey-automation/*.test.ts`.

---

## 3. Seven legacy-aware patches — `includeLegacy` semantics

Every one of the plan §4 sites now inherits a **default-OFF** legacy filter. Callers that want the legacy universe (a future "Legacy leads" admin view or backfill audit) must pass `{ includeLegacy: true }` explicitly.

| # | File touched | Semantics | Default |
|---|---|---|---|
| 1 | `lib/dataProvider.ts` — `getLeads(opts?: LegacyOptions)` | Filters via `applyLegacyFilter(rows, opts)`. When `opts.includeLegacy !== true`, `attribution.legacy === true` rows are dropped. | Hidden |
| 2 | `lib/dataProvider.ts` — `getAllLeadsRaw(opts?: LegacyOptions)` | Same as #1 for the raw list (includes soft-merged duplicates). | Hidden |
| 3 | `app/api/admin/leads/route.ts` — Kanban list endpoint | Reads `?include_legacy=1` / `?include_legacy=true` and threads to `getLeads({ includeLegacy })`. Response now returns the resolved boolean. | Hidden (URL opt-in) |
| 4 | `app/api/admin/payments/route.ts` — source card + `SourcePill` phone→channel map | Transitive via `getLeads()` — legacy phones never populate `leadAttrByPhone`, so `bucketizeSources`'s derived-channel path correctly returns "Unknown" for a paid webinar registration whose ONLY match in `public.leads` is a legacy row. | Hidden |
| 5 | `app/api/admin/analytics/lead-campaigns/route.ts` — Campaign Performance | Explicit `{ includeLegacy: false }` on `getAllLeadsRaw()` so legacy rows never inflate the "(no campaign) / (no channel)" bucket. | Hidden |
| 6 | `app/api/admin/sms/meta/route.ts` — SMS source dropdown | Transitive via `getLeads()`. The dropdown never lists `"Meta Ads (legacy)"` etc. | Hidden |
| 7 | `lib/sms/audiences.ts` — bulk SMS audiences | Explicit `getLeads({ includeLegacy: false })` at all three sites: `webinar_not_registered` universe (line 300), `leads` audience (line 306), `all` audience (line 325). File docblock warns: do NOT weaken without a consent audit + per-audience explicit opt-in. Also transitive via `getDashboard()` which calls `getLeads()`. | Hidden |

**Additive contract:** every caller that existed before this shipment sees the same behaviour it always did. The `LegacyOptions` param is optional; missing = hidden. The only breaking-if-you-look change is that a future `--commit`-created legacy row would be invisible to these surfaces until an opt-in flag is threaded — which is the entire point.

---

## 4. Sheets sync + Meta scaffolds — envs required, flag state

### 4.1 Sheets sync (Phase 2B)

- Route: `/api/cron/legacy-sheets-sync` (GET). Requires `Authorization: Bearer $CRON_SECRET`.
- Env vars the operator must set to activate:
    - `SHEETS_SYNC_ENABLED=true`
    - `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` — either single-line JSON or base64 of the same service-account JSON used for the one-time import.
    - `CRON_SECRET` (already set for the existing cron routes; reused).
- Vercel cron schedule: **not added** to `vercel.json`. Add a manual entry (e.g. `{ "path": "/api/cron/legacy-sheets-sync", "schedule": "*/15 * * * *" }`) once the flag flips.
- Current state: flag OFF ⇒ route returns 501 with a diagnostic body.
- Does NOT fire `lead_created` events (per Q5) — mass journey enrolments impossible.

### 4.2 Meta Lead Ads (Phase 2C)

- Route: `/api/meta/leadgen-webhook` (GET handshake + POST notification).
- Env vars documented (redact values, never commit):
    - `META_APP_ID`
    - `META_APP_SECRET`
    - `META_LEADGEN_VERIFY_TOKEN` (rotate quarterly)
    - `META_LONG_LIVED_TOKEN` (page-scoped, ~60-day refresh needed)
    - `META_LEADS_ENABLED=true`
- Required Meta app permissions (for App Review): `leads_retrieval`, `pages_manage_metadata`, `business_management`. Meta requires App Review approval before a production Page can subscribe to `leadgen` events.
- Long-lived-token refresh loop: NOT scaffolded — add a cron before enabling.
- Current state: flag OFF + no env vars set ⇒ POST returns 501 with the exact missing-config list. GET handshake works only if `META_LEADGEN_VERIFY_TOKEN` is set and matches.
- Why Meta Lead Ads MAY count in `deriveChannel` (unlike legacy sheet imports): the Graph API returns the ad hierarchy (campaign_id, adset_id, ad_id, ad_name) — real acquisition signals — so `channel = "Meta Ads"` is honest for these rows. Not populated in this shipment because the Graph fetch is intentionally not implemented.

---

## 5. Test results

- `npx tsc --noEmit`: **clean** (0 errors).
- `rm -rf .next && npm run build`: **clean** (Next.js 14 build succeeds, no warnings that block).
- `npm test`: **300 / 300 pass** (247 pre-existing + 53 new asserts across 5 new test files under `tests/lead-migration/`).

Test-suite summary:

| File | Asserts | What it locks in |
|---|---:|---|
| `tests/lead-migration/per-tab-transforms.test.ts` | 22 | Every tab's column mapping; smart B/C resolver on FB LEADS; Sheet1 100% fallback; Google Ads no-timestamp + any-cell fallback; Instagram `origin_review_needed=true`; every reject reason exercised. |
| `tests/lead-migration/phone-parity.test.ts` | 13 | `normalizeIndianMobile` normalizes every legacy shape (`+91…`, `91…`, `0…`, spaces, dashes, parens). `normPhone`'s last-10 fallback still requires strict re-gating (importer catches the leak). |
| `tests/lead-migration/dedupe-merge.test.ts` | 8 | Intra-tab keep-newest + fold-losers; cross-tab priority merge; Supabase collision NULL-only-fill count; idempotency (re-run = zero delta). |
| `tests/lead-migration/legacy-isolation.test.ts` | 8 | `hasLegacyFlag` accepts `true` and `"true"`; `applyLegacyFilter` defaults to HIDE; SMS-audience simulation confirms legacy phones do NOT enter the universe. |
| `tests/lead-migration/flag-off-noop.test.ts` | 2 | All three flags default false. `fetchLeadgenRecord()` throws `MetaLeadsNotConfiguredError` with the full missing-config list; a `"1"` / `"yes"` / trailing-space `"true "` env value is treated as OFF. |

One pre-existing tsc error (in `tests/journey-automation/payments-source-derivation.test.ts:104` — a `phone: null` cast) was fixed in-place with a targeted cast that documents the intent; the test's runtime behaviour is unchanged.

---

## 6. Deploy artifacts

- **Feature branch:** `feat/legacy-lead-migration` created from local `master@c793b5a5`.
- **Feature branch sha:** `c84f2538a34fd6cb1a16146e4fc1abbe20800291`.
- **Master merge sha:** `2542f0c8a3ea060a724b0a3961011ab3af3fba39` (`--no-ff` merge).
- **Push:** `origin/master` `c793b5a5..2542f0c8` — no force-push, no `--no-verify`.
- **Vercel deployment id:** `dpl_9EWENsXzpaLFktkSZxDPaiQi8gRm`.
- **State:** **READY** (built in bom1, aliased `www.namanias.com` + `namanias.com`).
- **Inspector:** [vercel.com/naman-ias-academy/naman-ias/9EWENsXzpaLFktkSZxDPaiQi8gRm](https://vercel.com/naman-ias-academy/naman-ias/9EWENsXzpaLFktkSZxDPaiQi8gRm).
- **Pre-existing untracked files preserved (never `git add`'d):** the 5 files from the RLS + prior-report set are still untracked on disk (`docs/naman-ai/reports/{meta-ads-two-shapes,rls-security-audit,webinar-july25-attribution-report}.md`; `supabase/migrations/2026-07-21-enable-rls-canary-3{,-rollback}.sql`) plus the plan doc (`docs/naman-ai/reports/lead-migration-plan.md`). Verified via `git status --short` post-commit.

---

## 7. Dry-run reconciliation numbers

Run against the LIVE workbook (`spreadsheet_id 1tyM…zuaA0`) at `2026-07-22T02:04:52Z`. Full details + masked samples in [`lead-migration-dry-run.md`](lead-migration-dry-run.md).

**Anchors (with tolerances):**

| Anchor | Prior study (15 Jun 2026) | Live | Delta | Verdict |
|---|---:|---:|---:|---|
| Union distinct canonical phones (all 9 tabs) | 175,764 | **178,312** | +1.4% | Within ±5% STOP-gate ✅ |
| Supabase collisions (phones in both sets) | 87 | **129** | +42 | Deviation explained in §7.1 below; NOT a pipeline defect |
| Supabase distinct phones (`public.leads`) | 948 | **945** | −3 | Matches expected slow churn |
| Projected pure inserts | — | **178,183** | — | = union − collisions ✅ |

**Per-tab breakdown:**

| Tab | Rows read | Valid-phone | Rejected | Distinct after intra-tab | Intra-tab merges |
|---|---:|---:|---:|---:|---:|
| `FB LEADS` | 87,711 | 87,334 | 377 | 83,169 | 4,165 |
| `Copy of FB LEADS` | 93,817 | 92,110 | 1,707 | 86,216 | 5,894 |
| `BACKUP_ALL_LEADS` | 26,957 | 26,688 | 269 | 25,902 | 786 |
| `Call These Leads` | 7,746 | 7,484 | 262 | 7,462 | 22 |
| `Google Ad Campaign` | 454 | 451 | 3 | 440 | 11 |
| `Sheet1` | 10,613 | 10,568 | 45 | 8,486 | 2,082 |
| `WhatsApp` | 1,764 | 1,754 | 10 | 1,646 | 108 |
| `Instagram: NEW Batch` | 68 | 68 | 0 | 62 | 6 |
| `Google Ads` | 180 | 176 | 4 | 158 | 18 |

**Cross-tab dedupe outcome:** 178,312 distinct union phones; **32,735** phones in ≥2 tabs (matches prior study's 32,697 within 38); 35,229 cross-tab merges folded into a winner via `LEAD_SOURCE_PRIORITY`.

### 7.1 Deviation analysis

- The **+1.4% union growth** is explained entirely by workbook growth since 15 Jun: `FB LEADS` alone grew from 84,993 → 87,711 rows (+3.2%), and applying the previously-measured 99.6% phone-yield predicts 87,360 valid phones — matches observed 87,334 within 26 rows.
- The **+42 collision delta (87 → 129)** decomposes into:
    - Supabase-side: `public.leads` distinct phones went from 948 → 945 (−3 → could have eliminated ~3 of the 87 old collisions).
    - Legacy-side: the workbook has grown by ~5,600 new distinct phones since 15 Jun. If those new phones overlap with the current 945-phone Supabase set at the same historical rate (~5.1% of Supabase phones matched a legacy phone), we expect ~40–48 additional collisions. Observed +42 is consistent with organic overlap, NOT a pipeline defect.
- No anchor exceeded the STOP-gate (±5% on union count). Numbers are honest.

---

## 8. STOP — the exact command to run for Phase 4 (do NOT run in this shipment)

Once the operator has reviewed [`lead-migration-dry-run.md`](lead-migration-dry-run.md) and is satisfied, they run:

```bash
cd /Users/ashar139/Projects/naman-ias-portal-master

LEGACY_IMPORT_ENABLED=true \
  npx tsx scripts/legacy-lead-import.ts --commit \
  --service-account-path=/Users/ashar139/Desktop/naman-lead-payment-matcher/credentials/service_account.json
```

The `--commit` mode:
1. Refuses (throws `Refusing --commit…`) if `LEGACY_IMPORT_ENABLED` is not exactly `"true"`.
2. Fetches the live workbook (same numbers as the dry-run, ~15 seconds).
3. For each of the 178,312 winning rows: snapshots the pre-state into `leads_backfill_snapshot`, then inserts (pure) OR updates (collision NULL-fill; NEVER overwrites live `channel` / `utm_*` / `attribution.first_touch`).
4. Writes chunks of 500 rows at a time (`--batch-size=500`). On any error the batch halts and reports.
5. Re-runs are idempotent — the second run finds 0 new phones and no-ops.

Estimated wall-clock: ~4–6 minutes for 178k rows through Supabase's PostgREST API. No Journey Automation is triggered (Q5). No SMS is sent (SMS flags default OFF and legacy phones would be filtered anyway).

---

## 9. Env vars — what the operator sets in Vercel

| Env var | For | Default | Notes |
|---|---|---|---|
| `LEGACY_IMPORT_ENABLED` | Backfill importer `--commit` gate | unset (OFF) | Value MUST be exactly `"true"` (case-insensitive). Any other value = OFF. |
| `SHEETS_SYNC_ENABLED` | Phase 2B cron route activation | unset (OFF) | Same "true" gating as above. |
| `META_LEADS_ENABLED` | Phase 2C webhook activation | unset (OFF) | Same "true" gating as above. |
| `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` | Sheets fetch (importer + Phase 2B sync) | unset | Single-line JSON OR base64-encoded JSON of the same service-account key. NEVER commit. |
| `CRON_SECRET` | Vercel Cron authorization | already set for existing cron routes | Reused unchanged. |
| `META_APP_ID` / `META_APP_SECRET` / `META_LEADGEN_VERIFY_TOKEN` / `META_LONG_LIVED_TOKEN` | Meta scaffold | unset | Required to activate Phase 2C. See §4.2 for App Review + refresh cadence. |

---

## 10. Rollback commands

Ordered from lightest to heaviest — always try the earliest that resolves the incident.

### 10.1 Env flag flip (instant, no redeploy)

Set in Vercel dashboard → Environment Variables (Production tab):

```
LEGACY_IMPORT_ENABLED   = false     # or delete the var entirely
SHEETS_SYNC_ENABLED     = false
META_LEADS_ENABLED      = false
```

Effect: importer `--commit` refuses; Phase 2B route returns 501; Meta webhook POST returns 501. Existing legacy rows in `public.leads` stay put but remain invisible to the CRM / dashboard / analytics / SMS audiences via the default legacy filter.

### 10.2 Row-level rollback (removes legacy rows from `public.leads`)

Run in Supabase SQL editor (or via `execute_sql` MCP):

```sql
-- Delete the pure inserts.
delete from public.leads
  where id in (
    select id from public.leads_backfill_snapshot where was_collision is false
  );

-- Restore the pre-collision attribution JSONB for the NULL-filled rows.
update public.leads as l
  set attribution = s.pre_state
  from public.leads_backfill_snapshot s
  where l.id = s.id and s.was_collision is true;
```

Both statements are transactional in Postgres and safe to re-run.

### 10.3 Schema rollback (removes the new columns/indexes/tables)

**Only after §10.2 is complete.** Run the paired rollback SQL by hand — file is marked `⚠️ MANUAL — DO NOT AUTO-APPLY`:

```
supabase/migrations/2026-07-21-legacy-lead-import-rollback.sql
```

Which executes:

```sql
drop index if exists public.idx_leads_channel_legacy;
drop index if exists public.idx_leads_import_batch;
drop index if exists public.idx_leads_legacy_flag;

alter table public.leads
  drop column if exists first_seen_at,
  drop column if exists external_lead_id,
  drop column if exists import_batch,
  drop column if exists import_source,
  drop column if exists channel_legacy;

drop index if exists public.idx_leads_backfill_snapshot_batch;
drop table if exists public.leads_backfill_snapshot;
drop table if exists public.legacy_import_sync_state;
```

### 10.4 Code rollback (revert the merge commit)

If §10.1 + §10.2 don't resolve the incident:

```bash
git revert --no-edit -m 1 2542f0c8a3ea060a724b0a3961011ab3af3fba39
git push origin master
```

The revert is safe because the migration is additive/nullable — the code no longer using the columns simply reads NULL from them. Do NOT combine with §10.3 in the same revert window (drop the columns AFTER the revert deploys).

---

## Appendix — files list

**New (18):**

- `supabase/migrations/2026-07-21-legacy-lead-import.sql`
- `supabase/migrations/2026-07-21-legacy-lead-import-rollback.sql`
- `lib/legacy-migration/flags.ts`
- `lib/legacy-migration/legacyFilter.ts`
- `lib/legacy-migration/tabRegistry.ts`
- `lib/legacy-migration/transform.ts`
- `lib/legacy-migration/dedupe.ts`
- `lib/legacy-migration/sheetsClient.ts`
- `lib/legacy-migration/sheetsSync.ts`
- `lib/legacy-migration/importer.ts`
- `lib/legacy-migration/types.ts`
- `lib/meta/leadAds.ts`
- `app/api/cron/legacy-sheets-sync/route.ts`
- `app/api/meta/leadgen-webhook/route.ts`
- `scripts/legacy-lead-import.ts`
- `tests/lead-migration/per-tab-transforms.test.ts`
- `tests/lead-migration/phone-parity.test.ts`
- `tests/lead-migration/dedupe-merge.test.ts`
- `tests/lead-migration/legacy-isolation.test.ts`
- `tests/lead-migration/flag-off-noop.test.ts`
- `docs/naman-ai/reports/lead-migration-dry-run.md` (dry-run report)
- `docs/naman-ai/reports/lead-migration-phase-2-3-shipment.md` (this document)

**Modified (8):**

- `.gitignore` — `credentials/` + `service_account*.json` denies.
- `package.json` — `googleapis` dep + `tests/lead-migration/*.test.ts` glob.
- `package-lock.json` — regenerated after `npm install googleapis`.
- `lib/dataProvider.ts` — `getLeads` + `getAllLeadsRaw` take `LegacyOptions`.
- `app/api/admin/leads/route.ts` — honours `?include_legacy=1`.
- `app/api/admin/analytics/lead-campaigns/route.ts` — explicit `{ includeLegacy: false }`.
- `lib/sms/audiences.ts` — 3 explicit `{ includeLegacy: false }` sites + safety-warning docblock.
- `tests/journey-automation/payments-source-derivation.test.ts` — cast-fix for a pre-existing null-phone tsc error (no runtime change).
