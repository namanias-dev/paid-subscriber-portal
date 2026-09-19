# Notes Store — database and migrations

## Migration order (Notes Store)

1. `supabase/migrations/2026-09-16-notes-store-1a-item-type-constraint.sql` — pin academy `payments.item_type`
2. `supabase/migrations/2026-09-16-notes-store-1a-schema.sql` — core `store_*` schema + RLS
3. `supabase/migrations/2026-09-17-notes-store-1b-grants-and-categories.sql`
4. `supabase/migrations/2026-09-17-notes-store-1b-inventory.sql` — reservation RPCs
5. `supabase/migrations/2026-09-17-notes-store-1c-verify-fixtures.sql`
6. `supabase/migrations/2026-09-19-notes-store-tracking-token-hash.sql` — `tracking_token_hash`, clear plaintext

## Tables (`store_*`) — 20

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
