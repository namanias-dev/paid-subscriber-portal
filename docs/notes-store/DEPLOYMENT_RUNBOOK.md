# Notes Store — deployment runbook

## Project

- Vercel project (historical): `naman-ias` / team `naman-ias-academy`  
- Region: `bom1` (`vercel.json`)  
- **Aliases move** — treat deployment IDs as historical only.

## Branches

| Branch | Role |
|--------|------|
| `master` | Production track — **do not merge handoff branch without owner** |
| `notes-store-release-hardening` | Implementation + docs handoff |
| Tag `notes-store-handoff-2026-09-19` | Annotated snapshot |

## Preview vs production

| | Preview | Production |
|--|---------|------------|
| Store DB flag | Prefer leave off | **Must stay off** until owner |
| `NOTES_STORE_PREVIEW_ENABLE` | May be `1` | Must not honour / must not set |
| Deploy | Auto on branch push | Owner-controlled |

## Migrations

Apply Supabase migrations in order listed in `DATABASE_AND_MIGRATIONS.md` via authenticated Supabase tooling. Do not invent destructive rollbacks for additive columns.

## Cron

`notes-store-verify` every 15 minutes requires production/preview cron + `CRON_SECRET`. Preview crons may differ by Vercel plan — verify in dashboard.

## Smoke (no charge)

1. `/api/notes/status` → enabled only where intended  
2. Product page renders  
3. Cart add  
4. Order page without token → capability prompt  
5. Track/verify bad inputs → non-enumerable 404  

## Prohibitions

- Do not enable production store in this handoff.  
- Do not real-charge to validate deploy.  
- Do not disable Deployment Protection without owner (affects automation).
