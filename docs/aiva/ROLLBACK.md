# AIVA — Rollback

AIVA is additive and isolated. Rollback options, least to most drastic:

## 1. Disable AIVA instantly (no deploy)
Set on the `namanias-aiva` Vercel project and redeploy (or use instant env update):
```
AIVA_ENABLED=false
```
The command center returns a disabled notice; all APIs return 503/401. The portal is unaffected.

## 2. Force read-only (already the default)
```
AIVA_READ_ONLY=true
```
Blocks every amber/red action server-side regardless of other flags.

## 3. Roll back an AIVA deployment
In Vercel → `namanias-aiva` → Deployments → promote the previous good deployment. The portal project is a separate deployment history and is untouched.

## 4. Revert the code
AIVA lives entirely under `aiva/` plus these additive portal files:
- `supabase/migrations/2026-07-11-aiva-foundation.sql`
- `docs/aiva/*`
- `scripts/aiva-sync-codebase-intelligence.ts`
- `.gitignore` (added `aiva/` build-artifact ignores)

Reverting the AIVA feature branch removes all of it. The portal has no imports of AIVA, so reverting cannot break the portal build.

## 5. Roll back the database migration
The migration only CREATEs new tables. To remove them (data loss for AIVA-only tables):
```sql
drop table if exists public.aiva_system_health_checks;
drop table if exists public.aiva_audit_log;
drop table if exists public.aiva_action_runs;
drop table if exists public.aiva_action_approvals;
drop table if exists public.aiva_action_requests;
drop table if exists public.aiva_recommendations;
drop table if exists public.aiva_codebase_snapshots;
drop table if exists public.business_events;
```
No existing portal table is touched, so this is safe with respect to production data.

## Blast radius summary
- Portal (`namanias.com`): **zero** — no shared runtime, no modified routes, no changed env.
- AIVA (`aiva.namanias.com`): fully reversible via flag, deploy promotion, code revert, or table drop.
