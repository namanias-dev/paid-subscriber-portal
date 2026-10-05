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
| Courier / AWB entry | BUILT BUT HUMAN/EXTERNAL VERIFICATION PENDING | Manual ship. Does not buy a label. |
| Courier rate quote | BUILT BUT HUMAN/EXTERNAL VERIFICATION PENDING | Admin compare. Delhivery read API verified. Shiprocket panel login is not an API user (403). |
| Shipping aggregator writes | OUT OF CURRENT PHASE | Label, AWB creation, and pickup stay off. |
| Real Eazypay transaction | **DEFERRED BY OWNER** | Checklist preserved; not executed |
| Notifications / DLT send | OUT OF CURRENT PHASE | Templates drafted, **not submitted**; `notes_store_sms` off |
| Shipping aggregator | OUT OF CURRENT PHASE | See courier rate quote. `notes_store_shiprocket` does not create shipments. |
| Coupons | OUT OF CURRENT PHASE | Flag off; schema may allow later |
| Bundles composition UI | OUT OF CURRENT PHASE | Schema `store_bundle_items`; limited Phase 1 UX |
| Reviews | OUT OF CURRENT PHASE | Table exists; flag off; no fake social proof |
| Invoices / returns portal | NOT BUILT / OUT OF PHASE | Spec later |
| Logged-in order history | NOT BUILT | Guest track + token only |
| Analytics store events | BUILT BUT HUMAN/EXTERNAL VERIFICATION PENDING | Attribution freeze at checkout; full event suite uneven |
| Feature flags | BUILT AND AUTOMATED-VERIFIED | Preview override tests |
| Production store | LIVE | `notes_store` enabled by the owner (recorded 2026-10-05: `enabled=true`, `scope=all`); the "disabled" entries below are the 2026-09-19 handoff snapshot |
| Academy Pickup | SEE BELOW | Order-level fulfilment beside Delivery; `docs/notes-store/ACADEMY_PICKUP.md` |
| Preview store enable | BUILT AND AUTOMATED-VERIFIED | `NOTES_STORE_PREVIEW_ENABLE` preview-only |
| Playwright e2e | NOT BUILT | No Playwright in `package.json` |
| Valid Lighthouse (store pages) | NOT BUILT | SSO login Lighthouse scores are **invalid** — do not cite as store scores |

## Explicit records

1. **Historical (2026-09-19):** production `notes_store` was disabled at handoff. **Superseded:** the owner has since enabled it; as of 2026-10-05 production reads `enabled=true`, `scope=all`, `kill_switch=false`.
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
| Commerce upgrade: premium subject cards, ₹2,999 base, admin-controlled Launch Offer | BUILT | `store_offers` + hold/consume RPCs; `calculateStorePrice` is the quote/cart/checkout/Eazypay source of truth; bundles merchandising hidden via `notes_store_bundles` |
| See before you buy (sample reader + physical-copy video) | BUILT | Config in `lib/store/notesProof.ts`, one sample and one physical video per product slug. Polity: `media/store/samples/anti-defection-law/` and `media/store/videos/physical-notes/`. Economy: `media/store/samples/foreign-direct-investment/` and `media/store/videos/physical-notes-economy/`. Admin sample upload is unchanged. |
| Landing subject card uses the admin product cover | BUILT | `SubjectRail` passes `cover_url` into `NotebookStack`. Same `cover_image_key` as the PDP. No second upload. |

## External blockers preventing a browsable-by-owner preview (owner action)

1. **Vercel Deployment Protection (SSO)** — preview `/notes` 302-redirects to `vercel.com/sso-api`; unauthenticated browser QA/Lighthouse impossible. Owner must open it while logged into Vercel, add a Protection Bypass token, or relax protection for previews.
2. **`NOTES_STORE_PREVIEW_ENABLE=1` on the Vercel Preview environment** — required for `/notes` to open in preview. Cannot be set from here (no Vercel CLI; Vercel MCP unauthenticated). Must NOT enable the shared DB `notes_store` flag (that would light production).
3. **Cloudflare R2 + `SUPABASE_SERVICE_ROLE_KEY`** are only in Vercel envs, so the app cannot be fully run locally here to render the store either.

Baseline re-confirmed green after each commit. Production flag still disabled; no real Eazypay run.

### Noted handoff discrepancies (unchanged, for owner)

1. `notes-store-release-hardening` has **no common git history with `main`** (disjoint). Deployment runbook names `master` as production track; `main` is the GitHub default branch.
2. `handoff-state.json` `headCommit`/`treeHash` self-reference earlier commits (documented as expected); the annotated tag `notes-store-handoff-2026-09-19` is authoritative and verified (commit `2c1a440`, tree `6f970eb`).

## Real-time paid-order Telegram (2026-09-27)

Additive. After `applyStoreVerify` commits the first transition into `ORDER_CONFIRMED`, `fireNotesOrderPaidAlert` posts one HTML message to the executive-brief channel and one to the existing Sales & Admissions channel (`TELEGRAM_SALES_CHAT_ID`, title-checked). Idempotency is one `telegram_report_snapshots` row per destination: `notes_order_paid:<orderId>:executive` and `notes_order_paid:<orderId>:sales_admissions`. The original `notes_order_paid:<orderId>` row is not rewritten. Qualifying orders already paid more than 15 minutes before the dual-channel cutoff are marked `skipped` / `pre_existing` and are not sent. A one-off updated replay of `NIAS-N-2026-001002` uses `notes_order_manual_replay:<orderId>:customer_details_v2:<destination>` and does not touch payment or fulfillment. Telegram failure does not roll back the order. The 2-hour digest schedule is unchanged.

## Notes staff access (2026-09-28)

Staff were seeing the global “Page not found” screen because Notes pages call `notFound()` unless `store_manage_orders` is held, and that key is not on the production role rows. Super Admin still passes because `isSuperAdmin` expands to every permission. Read access is now `store_view_orders` (manage still implies read). Analytics, demand, overview, and store settings stay Super Admin only. Per-account overrides for the three named staff accounts are in `supabase/migrations/2026-09-28-notes-staff-order-access.sql`. Order mutations, courier actions, refunds, store settings, and Super Admin Notes routes deny when the live permission read fails; they do not keep a stale signed grant. Order, payment, and courier business logic is unchanged.

## Courier destination check (2026-09-29)

Compare Couriers stays manual. Staff choose one courier, and a failed booking returns to the list without booking another courier. After create, the provider read-back is checked by `lib/store/shipping/destinationCheck.ts`. PIN must match exactly and state must match after normalization. The city passes when it is the same place, the `store_pincode_cache` city or district for that PIN (state must match the cache row), or an alias in `PIN_CITY_ALIASES` for that exact PIN. A city that only contains, or is contained in, the order city or the PIN city is held as `city_confirm_required`: the AWB is kept, pickup is not requested, and staff see COURIER ADDRESS CONFIRMATION. **Confirm courier city** marks only that shipment `destination_accepted` and requests pickup. **Back** cancels that shipment. The customer address is never rewritten. A different PIN or state, or an unrelated city, cancels that one shipment as a destination mismatch. Delhivery no longer fails because Telephone1/Telephone2 come back blank, as long as a valid 10-digit phone was sent; booking still refuses to start without one. Shiprocket still has to echo the phone. New shipments store `quoted_rate_paise`, `booked_rate_paise`, `provider`, `courier`, `service`, `selected_at`, `selected_by` in `provider_payload`. The booked quote is not a provider invoice. `provider_charge_paise` is not stored because no current provider API or webhook in this app returns a billed charge. Compare Couriers shows CHEAPEST, UNDER ₹100, and "Lowest available rate is ₹X" when every eligible rate is above ₹100; rates above ₹100 can still be booked. Existing live AWBs are not re-evaluated.

## Invoice invariant (2026-09-29)

Every captured Notes order gets exactly one invoice. Production had been deployed from a branch without `afe0162` since 27 Sep 20:49 UTC, so orders containing Indian Economy Notes (live product `tax_configuration_status` null) stopped at `classification_unconfirmed` before an invoice row was created. The order line snapshot (`hsn_snapshot` 49011010, `tax_treatment_snapshot` nil, 0%) is authoritative again via `classificationFromSnapshot`. Numbers are drawn by `claim_store_invoice` (`supabase/migrations/2026-09-29-notes-store-invoice-claim.sql`): per-order advisory lock, existing invoice returned unchanged, counter increment and insert in one transaction, so a failed insert leaves no gap. Only one issuer renders a row (compare-and-set on `status` + `updated_at`). No number is drawn when lines plus customer shipping do not reach the captured order amount within ₹1; that order is flagged, not mis-invoiced. The 15-minute `notes-store-verify` cron runs `resumeIncompleteInvoices` (existing PENDING/FAILED/stale rows) and `repairMissingPaidInvoices` (paid orders with no row, newest first, paginated). Admin shows Invoice generating for a new paid order, Invoice needs attention plus **Retry invoice** after 5 minutes without a row, and never “Not applicable” for a paid order. Repair does not touch payments, orders, analytics, Telegram, or offers. The ICICI merchant-amount check (`343fb6b`, compare `BA`, not the card total) was restored in the same release. Discount codes from master are still not on this production line.

## Orders operations view (2026-09-29)

Read-only upgrade of `/admin/notes`. One row per customer (phone key, never name). Every captured order is listed separately inside that row, open parcels first. Each order shows full phone (admin only), delivery city/state from that order's address, products, amount, resolved package, the Paid chip, and a fulfillment status from the shared `PROGRESS` ladder (`stageProgress` in `lib/store/opsBoard.ts`). The row also shows courier · booked rate · provider, pickup / picked-up / delivered time, latest clean tracking text, and one plain ACTION REQUIRED line. The read model is built in `/api/admin/notes/orders` by `lib/store/orderOps.ts`. Items, products, and shipments are each one batched query; no provider API is called. The unused `customers` array was dropped from the grouped response (orders carry `group.paid_orders`).

- **Package:** live booked shipment dimensions, then `resolveBookingPackage` (saved order package, then single product × 1 profile), else PACKAGE REQUIRED. No default weight.
- **Times:** pickup is the provider date (plus time only when a slot time was stored). Picked-up and delivered are the times recorded by tracking sync (`picked_up_at` / `delivered_at`), not provider scan times; the row tooltip says so. Never `created_at` / `updated_at`.
- **Avg shipping rate KPI:** mean / min / max of the saved booked courier rate (`provider_payload.booked_rate_paise`, else `rate_paise`) over one live shipment per captured non-QA order, from packed-with-AWB through delivered. Cancelled/failed/superseded shipments, QA orders, unpaid orders, pending courier-city confirmation, and missing rates are excluded (missing count shown in the tooltip). Integer paise, server-side. Like the other KPI tiles it is whole-store and ignores list filters. The customer's shipping charge is never used.
- **Refresh:** the list re-reads `/api/admin/notes/orders` every 45 s while the tab is visible and on focus (minimum 10 s gap), without the loading skeleton and without resetting filters; paused while order detail, compare, or an action is open.
- **Local QA:** `NOTES_STORE_LOCAL_FIXTURE=1` scene `ops_board` seeds TEST fixtures A–Q (`lib/store/localFixture.ts`).

## Orders mobile redesign (2026-09-29)

Presentation only; the `/api/admin/notes/orders` read model, statuses, and actions are unchanged. Below 1024 px each customer is a card (`OrderCustomerCardMobile`); at 1024 px and up it is a dense row (`OrderCustomerRowDesktop`). Both live in `components/notes/admin/orders/CustomerViews.tsx`, read the same `customerView(order)`, and share the primitives in `OrderOpsCell.tsx`. The operation strip text comes from `opsLines` in `lib/store/orderOpsDisplay.ts` (stage headline, booked rate or "Rate unavailable", one detail line, and a next-step hint from `ISSUE_HINT` for each ACTION REQUIRED issue). A multi-order customer gets one card with a module per order; timelines are never merged. The timeline announces "Packed. Stage 4 of 9." (`stageProgress().ariaLabel`). Motion uses only `motion` / `AnimatePresence` / `useReducedMotion`, the framer APIs the root layout already ships, so public Notes routes keep their first-load size; reduced motion disables entry, halo, and slide. The Help launcher sits above any element marked `data-admin-bottom-bar` (the order detail action bar) and never auto-opens.

## Analytics intelligence 2.0 (2026-10-03)

Read-only upgrade of `/admin/notes/analytics` (Super Admin only). Full definitions are in `ANALYTICS_INTELLIGENCE.md`, and the spec is `analytics-intelligence-2.md`. Existing KPIs, AOV, funnel, acquisition, campaigns, products, content, checkout health, landings, devices, promotions, CTAs and checkout leads are unchanged.

New sections:

- **Commerce & fulfillment strip:** avg booked shipping for orders paid in the range, current Packed / Pickup / In transit / Out for delivery (linked to Orders filters), and today's picked up / shipped / delivered in IST.
- **Subject performance:** subjects come from `store_products.subject`. Net product revenue uses integer-paise residual allocation and excludes customer shipping.
- **Sales over time:** gains Picked up / Shipped / Delivered event metrics and a Cumulative mode. The cumulative end value equals the KPI.
- **Geographic intelligence:** vendored CC BY 4.0 India SVG (lazy, admin-only), state ranking and table, state-scoped city ranking.
- **Shipping intelligence:** avg / median / min / max, ≤ ₹100 share, distribution, by state, city, courier and provider, coverage, and a documented rate-anomaly rule (≥ 1.5 × peer median and ≥ ₹40, same state + weight band, national fallback, 3-peer minimum).

The booked-rate eligibility rule is now one function, `rateShipmentFor` in `lib/store/orderOps.ts`, shared with the Notes Orders tile. Behaviour is unchanged.

`loadNotesIntel` runs beside the existing loaders and fails to `null`, so only the new sections degrade. No migration. No writes. `tests/notes-store-analytics/` is now part of `npm test`.

Production base was `f70cbc1`. Master-only work (Notes discount codes, the cookieless-view analytics fix, the mobile address-confirm scroll fix, counsellor no-auto-open) is still not on this production line and was not merged here.

## Courier quote history (2026-10-04)

Every Compare Couriers result is saved, as staff saw it, in `store_courier_quote_sessions` / `store_courier_quote_options` before it is shown. Every Book click is saved in `store_courier_booking_attempts` before the provider is called.

- Booking accepts only a saved `quote_session_id` + `quote_option_id`. Courier and price come from the stored option.
- Selections that are expired (15 min), ineligible, or made before a package/address change are refused with no provider call.
- Order detail shows Courier price history. The Orders list shows "N options compared".
- Orders booked earlier show "Historical quote list unavailable". Nothing was backfilled.
- The existing lock, one-active-AWB, destination check, label, pickup and tracking paths are unchanged.

Migration `2026-10-04-notes-store-courier-quote-history.sql` was applied to production on 2026-10-04: additive, RLS on, service role only. Release `be8bb64`. Details: `COURIER_QUOTE_HISTORY.md`.

## Academy Pickup (2026-10-05)

Customers can choose **Delivery** or **Pick up from academy** (Naman Sharma IAS Academy, SCO 173–174, 2nd Floor, Sector 17C, Chandigarh) per order. Pickup orders charge ₹0 shipping and follow PROCESSING → PRINTING → READY_FOR_COLLECTION → COLLECTED. Staff use Mark ready for collection and Mark collected, and both record who did it. Courier, AWB, label, package and courier-pickup flows refuse pickup orders at every API entry point, in auto-fulfil and in database triggers. Full design, SOP and rollback rules: `ACADEMY_PICKUP.md`.

| Item | Status | Notes |
|------|--------|-------|
| Migration `2026-10-05-notes-store-academy-pickup.sql` | APPLIED TO PRODUCTION | Additive; columns, status/method checks, freeze trigger, courier backstop triggers, issue categories, cart/lead columns, flag row (inserted disabled) |
| Release A (compatibility) `5818c53` | LIVE then superseded by Release B | `dpl_9pY9kEogb8i3jU6nNng7PjF52e5Q`; SAFE_COMPATIBILITY target for rollback |
| Release B (creation UI) | See `handoff-state.json` `academyPickup` | Cart/checkout chooser, pickup checkout, leads, events |
| Flag `notes_store_academy_pickup` | See `handoff-state.json` | Creation only; existing pickup orders always operable |
| Interim place of supply for pickup | PENDING CA CONFIRMATION | Customer PIN state; nil-rated lines only, taxable pickup refused before payment |
| SMS for ready/collected | INERT | Hooks exist; no DLT template; staff notify by WhatsApp/call |
| Real Eazypay pickup payment | NOT RUN BY AUTOMATION | Automated QA never pays; local E2E stubs the gateway |

