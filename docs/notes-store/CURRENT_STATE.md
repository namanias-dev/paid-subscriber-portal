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

## Continuation — branch `notes-store-continuation-2026-09-19` (from handoff tag)

Automated-verified only (tsc + isolation guard + 53/53 store tests + `next build` with preview enable). **Not** browser/DB-verified on the continuation machine (no env pulled).

| Change | Status | Notes |
|--------|--------|-------|
| PDP renders full `description_md` + subject/stage chips | BUILT AND AUTOMATED-VERIFIED | New server component `components/notes/ProductDescription.tsx` (react-markdown, no raw HTML) |
| PDP `BreadcrumbList` JSON-LD | BUILT AND AUTOMATED-VERIFIED | Beside existing Product/Offer; `SITE_URL` from `lib/config` |
| Checkout shows server-authoritative shipping + tax + total | BUILT AND AUTOMATED-VERIFIED | `buildFrozenQuote()` extracted from `lockQuote()`; `/api/notes/pin` returns `quote`; no client-side total |
| Admin product media upload (photos + watermarked samples) to R2 | BUILT (AUTOMATED-VERIFIED compile/guard; needs R2+DB for runtime) | `lib/store/media/upload.ts` + `/api/admin/notes/media` + `MediaManager`; reuses `lib/r2` + watermark pipeline (previously unused) |
| Availability model (ready_stock / on_demand / coming_soon / unavailable) | BUILT AND AUTOMATED-VERIFIED (unit tests; needs DB for e2e) | `lib/store/availability.ts`; wired through catalogue, cart, quote, checkout, ProductCard, PDP, admin editor; additive migration |
| Preparation-demand queue (paid-unfulfilled, bundles exploded) | BUILT AND AUTOMATED-VERIFIED (unit tests; needs DB for e2e) | `lib/store/preparation.ts` + `/api/admin/notes/preparation` + `/admin/notes/preparation` |
| PDP richer content (subtitle, author, booklets, what's-included, who-it's-for, disclaimers) | BUILT AND AUTOMATED-VERIFIED | Admin-editable via product API; PDP renders when present |
| Admin order management (search, buckets, copy address/phone/block, exceptions) | BUILT (compile/tests; needs DB for runtime) | `/api/admin/notes/orders` + `/orders/[id]/note` + rebuilt `OrderQueue` |
| Admin overview (action-required dashboard) | BUILT (compile/tests; needs DB for runtime) | `/admin/notes/overview` + `/api/admin/notes/overview` |
| Bundles (admin components + storefront detail with savings) | BUILT (compile/tests; live demo bundle seeded) | `/api/admin/notes/bundles` + `BundleComponents`; PDP shows included notes, individual total, savings; demand flows through components |
| Notes commerce analytics events | BUILT AND AUTOMATED-VERIFIED (compile) | Reuses `/api/track` + `trackClient`; PII-free `notes_*` events allow-listed in `lib/analytics/events.ts` |
| Availability migration applied to Academy DB | DONE | `notes_store_availability` applied + verified on project `xqwdfyzerzsllqiyzxem`; 6 cols + index; existing rows default ready_stock |
| Demo catalogue seeded (all modes + bundle) | DONE | TEST-labelled: ready_stock, on_demand, coming_soon, unavailable + GS Starter bundle |
| Shipping-provider abstraction (manual + Shiprocket boundary) | BUILT AND AUTOMATED-VERIFIED (compile) | `lib/store/shipping/**`; ship route uses `selectShippingProvider()`; manual always available |
| Customer notification boundary (order confirmed/shipped SMS) | BUILT — inert (double-gated) | `lib/store/notifications.ts`; wired into capture + ship; sends nothing until `notes_store_sms` + approved DLT template ids |
| Subject-oriented Notes admin (catalogue cards + dedicated editor) | BUILT (compile/tests; needs DB/R2 for runtime) | `/admin/notes/products` cards → `/admin/notes/products/[id]` `ProductEditor` (all content sections, repeatable lists, ₹ pricing, availability cards, publishing, save-state, view-as-student) |
| PDF sample upload → page select → watermarked derivatives | BUILT AND AUTOMATED-VERIFIED (rasterize+watermark chain unit-tested) | mupdf WASM; private PDF original never served; `lib/store/media/pdf.ts` + media API |
| Safe delete / archive with order-history integrity | BUILT | `DELETE`/`PATCH archive` on `/api/admin/notes/products/[id]` |
| PDP renders admin content (topics, how-to-use, prelims/mains/revision) | BUILT | catalogue detail + PDP sections |
| Store test suite | 64 pass / 0 fail | +7 availability/prep +4 PDF-pipeline tests |
| Premium storefront redesign + subject interest | BUILT AND AUTOMATED-VERIFIED | Elevation tokens, landing/PDP/cart/checkout/track polish, `store_subject_interest`, admin interest dashboard |
| Cinematic notebook hero + Student Voices | BUILT AND AUTOMATED-VERIFIED | Real product PNG hero; compact preference-set poll after Shop by Subject; admin Notes Demand / co-selection |

## External blockers preventing a browsable-by-owner preview (owner action)

1. **Vercel Deployment Protection (SSO)** — preview `/notes` 302-redirects to `vercel.com/sso-api`; unauthenticated browser QA/Lighthouse impossible. Owner must open it while logged into Vercel, add a Protection Bypass token, or relax protection for previews.
2. **`NOTES_STORE_PREVIEW_ENABLE=1` on the Vercel Preview environment** — required for `/notes` to open in preview. Cannot be set from here (no Vercel CLI; Vercel MCP unauthenticated). Must NOT enable the shared DB `notes_store` flag (that would light production).
3. **Cloudflare R2 + `SUPABASE_SERVICE_ROLE_KEY`** are only in Vercel envs, so the app cannot be fully run locally here to render the store either.

Baseline re-confirmed green after each commit. Production flag still disabled; no real Eazypay run.

### Noted handoff discrepancies (unchanged, for owner)

1. `notes-store-release-hardening` has **no common git history with `main`** (disjoint). Deployment runbook names `master` as production track; `main` is the GitHub default branch.
2. `handoff-state.json` `headCommit`/`treeHash` self-reference earlier commits (documented as expected); the annotated tag `notes-store-handoff-2026-09-19` is authoritative and verified (commit `2c1a440`, tree `6f970eb`).
