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

## Tables (`store_*`) — 23

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

**No FKs** from these tables into Academy `payments` / `students` / `buyers` / `leads` / enrollments.

## Important `store_orders` columns

- Money: `*_paise`, `quote_json`, `promo_code` (future)
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
