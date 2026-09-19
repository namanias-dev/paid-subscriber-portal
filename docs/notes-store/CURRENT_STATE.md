# Notes Store — current state

**As of:** 2026-09-19  

**Branch:** `notes-store-release-hardening`  
**Handoff tag (after this commit):** `notes-store-handoff-2026-09-19`

## Legend

| Status | Meaning |
|--------|---------|
| **BUILT AND AUTOMATED-VERIFIED** | Code + automated tests/guards pass |
| **BUILT BUT HUMAN/EXTERNAL VERIFICATION PENDING** | Implemented; needs human/browser/gateway/ops confirmation |
| **DEFERRED BY OWNER** | Explicitly not doing now (e.g. real ₹1 payment) |
| **OUT OF CURRENT PHASE** | Spec/schema may exist; feature flags off / not wired |
| **NOT BUILT** | No production-ready path |

## Capability matrix

| Capability | Status | Notes |
|------------|--------|-------|
| Store landing `/notes` | BUILT AND AUTOMATED-VERIFIED | ISR catalogue; kill-switch gated |
| Subject/category pages | BUILT AND AUTOMATED-VERIFIED | `app/(site)/notes/[subject]` |
| Product detail | BUILT AND AUTOMATED-VERIFIED | Active-only; PIN widget |
| Sample-page previews | BUILT AND AUTOMATED-VERIFIED | Watermark tests pass; private originals |
| Cart | BUILT AND AUTOMATED-VERIFIED | Qty clamp to stock/max; cookie cart |
| Guest checkout | BUILT AND AUTOMATED-VERIFIED | No Academy identity write |
| Eazypay initiation | BUILT AND AUTOMATED-VERIFIED | `NIASN-N-` refs; paymode=9 |
| Shared callback dispatch | BUILT AND AUTOMATED-VERIFIED | Shim + course regression tests |
| Store Verify (terminal) | BUILT AND AUTOMATED-VERIFIED | `applyStoreVerify` sole terminal |
| Confirmation / pending UX | BUILT AND AUTOMATED-VERIFIED | ~90s poll + calm pending copy |
| Order access token security | BUILT AND AUTOMATED-VERIFIED | Hash-only DB; cookie/`?t=`; tests |
| Phone track | BUILT AND AUTOMATED-VERIFIED | Non-enumerable errors; rate limit |
| Inventory reservation | BUILT AND AUTOMATED-VERIFIED | Hold-until-ship on CAPTURED only |
| Admin catalogue | BUILT BUT HUMAN/EXTERNAL VERIFICATION PENDING | CRUD API + UI; preview admin login needed |
| Admin order queue/detail | BUILT BUT HUMAN/EXTERNAL VERIFICATION PENDING | Address + line items shown |
| Manual status advance | BUILT BUT HUMAN/EXTERNAL VERIFICATION PENDING | `/advance` API |
| Courier / AWB entry | BUILT BUT HUMAN/EXTERNAL VERIFICATION PENDING | Manual ship; no Shiprocket |
| Real Eazypay transaction | **DEFERRED BY OWNER** | Checklist preserved; not executed |
| Notifications / DLT send | OUT OF CURRENT PHASE | Templates drafted, **not submitted**; `notes_store_sms` off |
| Shipping aggregator | OUT OF CURRENT PHASE | Manual Phase 1; `notes_store_shiprocket` off |
| Coupons | OUT OF CURRENT PHASE | Flag off; schema may allow later |
| Bundles composition UI | OUT OF CURRENT PHASE | Schema `store_bundle_items`; limited Phase 1 UX |
| Reviews | OUT OF CURRENT PHASE | Table exists; flag off; no fake social proof |
| Invoices / returns portal | NOT BUILT / OUT OF PHASE | Spec later |
| Logged-in order history | NOT BUILT | Guest track + token only |
| Analytics store events | BUILT BUT HUMAN/EXTERNAL VERIFICATION PENDING | Attribution freeze at checkout; full event suite uneven |
| Feature flags | BUILT AND AUTOMATED-VERIFIED | Preview override tests |
| Production store | DISABLED | Must stay off until owner enables |
| Preview store enable | BUILT AND AUTOMATED-VERIFIED | `NOTES_STORE_PREVIEW_ENABLE` preview-only |
| Playwright e2e | NOT BUILT | No Playwright in `package.json` |
| Valid Lighthouse (store pages) | NOT BUILT | SSO login Lighthouse scores are **invalid** — do not cite as store scores |

## Explicit records

1. **Production `notes_store` is disabled** (`enabled=false`, `kill_switch=false`, `scope=off` as of handoff verification).
2. **Preview enable exists** via `NOTES_STORE_PREVIEW_ENABLE` and is **ignored when `VERCEL_ENV=production`**.
3. **No real Eazypay transaction has been performed** for Notes Store validation.
4. **Payment validation is deliberately deferred by owner.**
5. **Test SKU** (preview/ops only; do not market publicly):  
   - ID: `a1dcaa29-bc07-49ae-b810-2854e24d8d59`  
   - SKU: `TEST-NOTES-POLITY-001`  
   - Slug: `test-only-polity-notes`  
   - Price: ₹1 (100 paise)  
   - Inventory baseline at handoff: on_hand **2**, reserved **0**  
   - Name clearly labelled `TEST ONLY — Polity Notes`
6. **DLT:** bodies in `docs/notes-store-dlt-templates.md` — **not yet submitted** to TRAI operator.
7. **Lighthouse** against Vercel SSO login is **not** Notes Store performance evidence.
8. **Playwright** was and remains absent unless later added to the repo.

## Automated verification (handoff day)

- Isolation + media + access-token suites: **53 pass / 0 fail** (see `TESTING_AND_VERIFICATION.md`)
- `guard-store-domain-isolation.mjs`: **OK**
- `tsc --noEmit`: **clean** (handoff day)
