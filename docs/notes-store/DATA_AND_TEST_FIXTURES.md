# Notes Store — data and test fixtures

## Test SKU (ops / preview only)

| Field | Value |
|-------|-------|
| id | `a1dcaa29-bc07-49ae-b810-2854e24d8d59` |
| sku | `TEST-NOTES-POLITY-001` |
| slug | `test-only-polity-notes` |
| name | `TEST ONLY — Polity Notes` |
| selling_price_paise | `100` (₹1) |
| on_hand (handoff baseline) | `2` |
| reserved (handoff baseline) | `0` |
| is_active | `true` |

**Do not** market this SKU publicly. Deactivate (`is_active=false`) or delete only with ops care after payment experiments.

Zero-shipping PIN for ₹1 gateway total: **`160099`** (serviceability fixture).

## Scripts

- `scripts/notes-preview-smoke.mjs` — protected preview smoke; **no checkout charge** by default.
- Do not put real customer PII in scripts or fixtures.
- No seeded fake reviews/testimonials.

## Cleanup

```sql
-- Example only; run consciously
update store_products set is_active = false where sku = 'TEST-NOTES-POLITY-001';
```
