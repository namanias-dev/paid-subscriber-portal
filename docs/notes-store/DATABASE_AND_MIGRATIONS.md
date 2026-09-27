# Notes Store — database and migrations

## Migration order (Notes Store)

1. `supabase/migrations/2026-09-16-notes-store-1a-item-type-constraint.sql` — pin academy `payments.item_type`
2. `supabase/migrations/2026-09-16-notes-store-1a-schema.sql` — core `store_*` schema + RLS
3. `supabase/migrations/2026-09-17-notes-store-1b-grants-and-categories.sql`
4. `supabase/migrations/2026-09-17-notes-store-1b-inventory.sql` — reservation RPCs
5. `supabase/migrations/2026-09-17-notes-store-1c-verify-fixtures.sql`
6. `supabase/migrations/2026-09-19-notes-store-tracking-token-hash.sql` — `tracking_token_hash`, clear plaintext
7. `supabase/migrations/2026-09-19-notes-store-availability.sql` — **additive**: `store_products.availability_mode` (`ready_stock`|`on_demand`|`coming_soon`|`unavailable`, default `ready_stock`), plus `subtitle`, `author`, `booklets`, `highlights_json`, `ideal_for_json`; index `store_orders_status_idx` for the preparation-demand scan. Existing rows default to `ready_stock` (behaviour preserved).
8. `supabase/migrations/2026-09-20-notes-store-admin-content.sql` — product editor content fields
9. `supabase/migrations/2026-09-20-notes-store-subject-interest.sql` — **additive**: `store_subject_interest` (product_id, voter_hash, source, created_at). Demand signal only; no money/inventory/order changes.
10. `supabase/migrations/2026-09-20-notes-store-preference-submissions.sql` — **additive**: `store_interest_submissions` + `store_interest_submission_subjects`. One preference SET per voter hash (update-in-place). Not marketing consent.
11. `supabase/migrations/2026-09-21-notes-store-offers.sql` — **additive**: `store_offers` + `store_offer_holds`, hold/consume/release RPCs, `store_orders.offer_id`, merchandised singles → ₹2,999, `notes_store_bundles` flag (off), seed Launch Offer (20% / first 100 / 7-day window, all admin-editable).
12. `supabase/migrations/2026-09-25-notes-store-invoices.sql` — **additive**: `store_invoice_settings`, `store_invoice_counters`, `store_invoices`, `next_store_invoice_seq`. One invoice row per order. Historical orders are not backfilled.
13. `supabase/migrations/2026-09-26-notes-store-landing-thumbnail.sql` — **additive**: nullable `store_products.store_thumbnail_image_key`. No backfill. Null keeps the product cover on `/notes`.
14. `supabase/migrations/2026-09-27-notes-discount-codes.sql` — **additive**: `store_discount_codes`, `store_discount_code_products`, `store_discount_redemptions` (held / captured / released, one live hold per customer, one captured use when a per-customer limit is on), `store_discount_code_events`, hold/capture/release/expire RPCs, nullable order and lead coupon columns. No price or order column is rewritten. No NOTES500 row is inserted. Inserts `notes_store_coupons` disabled (`on conflict do nothing`).

## Tables (`store_*`) — 27

| Table | Purpose |
|-------|---------|
| `store_categories` | Subject/category nav |
| `store_products` | SKUs, prices (paise), inventory counters, media keys |
| `store_bundle_items` | Bundle composition |
| `store_product_media` | Photos + private sample pages |
| `store_stock_ledger` | Append-only stock movements |
| `store_inventory_reservations` | Hold rows until ship/release |
| `store_customers` | Guest customers by phone (not Academy identity) |
| `store_addresses` | Shipping snapshots |
| `store_carts` / `store_cart_items` | Server carts |
| `store_orders` / `store_order_items` | Orders + line snapshots |
| `store_order_events` | Order audit trail |
| `store_order_payments` | Store payment ledger |
| `store_payment_events` | Gateway event log (idempotent) |
| `store_shipments` / `store_shipment_events` | Manual courier/AWB |
| `store_zones` / `store_pincode_cache` | Serviceability |
| `store_reviews` | Schema present; feature flag off |
| `store_subject_interest` | Anonymous per-product “I want these notes” votes |
| `store_interest_submissions` | One Student Voices preference SET per voter hash |
| `store_interest_submission_subjects` | Selected `store_categories` for a submission |
| `store_offers` | Admin-controlled limited-time campaigns |
| `store_offer_holds` | Checkout-time offer capacity reservation |
| `store_invoice_settings` | Legal supplier and document mode. Empty GSTIN is left empty. |
| `store_invoice_counters` | Financial-year sequences. Production and test namespaces are separate. |
| `store_invoices` | Immutable issued snapshot, PDF key, and credit-note status |
| `store_discount_codes` | Entered promo codes. Fixed amount or percentage. Scope is all Notes or selected product ids. |
| `store_discount_code_products` | Product ids for `selected_products` scope |
| `store_discount_redemptions` | One row per order: held, captured, or released. Unique on `order_id`. |
| `store_discount_code_events` | Created, updated, activated, deactivated, archived |

**No FKs** from these tables into Academy `payments` / `students` / `buyers` / `leads` / enrollments.

## Important `store_orders` columns

- Money: `*_paise`, `quote_json`, `promo_code` (automatic offer slug), `coupon_code`, `coupon_id`, `coupon_discount_paise`, `coupon_snapshot`
- Access: `tracking_token` (**deprecated null**), `tracking_token_hash`
- Attribution: `attribution_json`, `attribution_source`, `attribution_campaign`, ids, `attribution_platform`
- `phone_key` generated from phone
- Status check constraint covers fulfilment + payment lifecycle values

## Inventory

RPCs in `2026-09-17-notes-store-1b-inventory.sql` (reserve/release/commit). App wrappers: `lib/store/inventory.ts`. Hold-until-ship on Verify CAPTURED.

## Order numbers

Function/sequence `next_store_order_no` → `NIAS-N-<year>-######`.

## Payment reference uniqueness

`store_order_payments.reference_no` unique; shape `NIASN-N-…`.

## RLS

Enabled on store tables in 1a schema. Service role used by Next server; do not grant anon write.

## Writers / readers (summary)

| Writer | Tables |
|--------|--------|
| Checkout | customers, addresses, orders, items, payments, carts, reservations |
| Callback | payment_events, order_payments (advisory), order_events |
| Verify | order_payments (terminal), orders, reservations hold/release, order_events |
| Admin | products, orders status, shipments |
| Catalogue (read) | products, categories, media |

Do **not** dump production rows or PII into docs.
