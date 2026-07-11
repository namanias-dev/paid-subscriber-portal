# AIVA — Environment Variables & Vercel Project Settings

AIVA is a **separate Vercel project** (`namanias-aiva`) with **Root Directory = `aiva`**, using the **same GitHub repo** and the **same Supabase database** as the portal.

## Required env (AIVA project only)

| Variable | Purpose | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Shared Supabase URL | Same value as the portal |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB access | Same value as the portal. Server-only. |
| `AIVA_JWT_SECRET` | AIVA session signing | Dedicated secret recommended. Falls back to `ADMIN_JWT_SECRET` if unset. |

## Feature flags (set on the AIVA project)

Defaults are safe (read-only). Set these explicitly in Vercel → Project → Settings → Environment Variables:

```
AIVA_ENABLED=true
AIVA_READ_ONLY=true
AIVA_3D_BRAIN_ENABLED=true
AIVA_WEBSITE_RECOMMENDATIONS_ENABLED=false
AIVA_CAMPAIGNS_ENABLED=false
AIVA_INSTALLMENT_REMINDERS_ENABLED=false
AIVA_LOCAL_WORKER_ENABLED=false
AIVA_OPENCLAW_ENABLED=false
AIVA_LEARNING_ENABLED=false
AIVA_AUTO_GREEN_ACTIONS_ENABLED=false
AIVA_EMIT_EVENTS=false
AIVA_DATA_RETENTION_DAYS=180
AIVA_SESSION_DAYS=7
```

## Vercel project settings for `namanias-aiva`

- **Framework preset:** Next.js
- **Root Directory:** `aiva`
- **Region:** `bom1` (match portal)
- **Domain:** `aiva.namanias.com`
- **Ignored Build Step** (so portal-only changes don't rebuild AIVA):
  ```bash
  bash -c 'git diff --quiet HEAD^ HEAD -- aiva/ ../lib/paymentsAgg.ts ../lib/paymentGroups.ts ../lib/installments.ts ../lib/permissions.ts ../lib/types.ts ../lib/dates.ts && exit 0 || exit 1'
  ```
  (Exit 0 = skip build. Because Root Directory is `aiva`, the command runs from `aiva/`, hence the `../lib/...` paths for the reused pure island.)

## Portal project (`namanias.com`) — do NOT rebuild for AIVA-only changes

Set the portal project's **Ignored Build Step** to skip when only `aiva/` or `docs/aiva/` changed:

```bash
bash -c 'CHANGED=$(git diff --name-only HEAD^ HEAD); echo "$CHANGED" | grep -qvE "^(aiva/|docs/aiva/)" && exit 1 || exit 0'
```

(Exit 1 = build; exit 0 = skip. Skips the build only when every changed file is under `aiva/` or `docs/aiva/`.)

## The portal remains unchanged

The only portal-side additions in this release are **additive and inert**:
- `supabase/migrations/2026-07-11-aiva-foundation.sql` (new tables only)
- `docs/aiva/*` (documentation)
- `scripts/aiva-sync-codebase-intelligence.ts` (CI helper, not imported at runtime)

No portal route, component, payment path, or env var is modified.
