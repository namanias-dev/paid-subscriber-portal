-- ============================================================================
-- Notes Store — Phase 1C. Verification fixtures only.
--
-- 1. A longest-prefix PIN with zero shipping so a ₹1 SKU can produce a ₹1
--    Eazypay charge. Seeded zones otherwise add ₹49–₹129 of shipping.
-- 2. The accidental 5-paise live SKU cannot be sold.
-- ============================================================================

insert into public.store_zones (
  pincode_prefix, zone, label, transit_days_min, transit_days_max, shipping_paise, position
)
values (
  '160099', 'test', 'TEST ₹1 verification PIN — zero shipping', 1, 1, 0, 1
)
on conflict (pincode_prefix) do update
  set shipping_paise = 0,
      label = excluded.label,
      zone = excluded.zone,
      transit_days_min = excluded.transit_days_min,
      transit_days_max = excluded.transit_days_max,
      position = excluded.position,
      updated_at = now();

update public.store_products
   set is_active = false, updated_at = now()
 where sku = 'test-notes'
   and selling_price_paise < 100
   and is_active = true;
