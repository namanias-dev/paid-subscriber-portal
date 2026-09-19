# Notes Store — new machine bootstrap

Exact safe steps for a fresh laptop / Cursor session.

1. Clone `namanias-dev/paid-subscriber-portal` (or open existing clone).  
2. `git fetch --all --tags`  
3. `git checkout notes-store-release-hardening`  
4. Verify tag: `git rev-parse notes-store-handoff-2026-09-19` and `git log -1 --oneline notes-store-handoff-2026-09-19`  
5. **Read order:**  
   - `docs/notes-store/README.md`  
   - `docs/notes-store/CURRENT_STATE.md`  
   - `docs/notes-store/DECISION_LOG.md`  
   - `docs/notes-store/HANDOFF_2026-09-19.md`  
   - `.cursor/skills/notes-store/SKILL.md`  
   - Then task-specific docs (payments/security/architecture)  
6. Install from lockfile: `npm ci` (or project-standard install).  
7. Link/auth Vercel + Supabase via official CLIs (`vercel link`, `vercel env pull` as needed). **Never commit `.env*`.**  
8. Baseline:  
   ```bash
   npx tsc --noEmit
   node scripts/ci/guard-store-domain-isolation.mjs
   node --import tsx --import ./scripts/_react-cache-shim.mjs --test tests/notes-store-isolation/*.test.ts tests/notes-store-media/*.test.ts
   ```  
9. Confirm production store still disabled before any deploy work.  
10. Resume from `KNOWN_GAPS_AND_ROADMAP.md` — first tasks that **do not** require a real payment.  
11. Real Eazypay: only when owner initiates; follow deferred checklist in `TESTING_AND_VERIFICATION.md` / `PAYMENTS_EAZYPAY.md`.
