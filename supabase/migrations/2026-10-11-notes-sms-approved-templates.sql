-- Notes Store SMS: the five DLT-approved templates, exactly as registered.
-- Source: Naman_IAS_Notes_SMS_Template_Approval_Tracker Final.xlsx, sheet
-- "Notes SMS Templates", rows 6–10. Canonical copy in lib/sms/notesApproved.ts;
-- the app refuses to send a Notes template whose row differs from it.
--
-- Idempotent. Reconciles rows with these ids to the approved values (category,
-- body, variables). Rows 3–5 contain U+2019 (’), written as U&'\2019' so an
-- editor cannot turn it into a straight apostrophe.
--
-- Automation rules are created DISABLED. They are switched on from Mission
-- Control → Notes Store, which records the activation cutover so nothing
-- older than the switch-on is ever sent.

insert into public.sms_templates
  (id, name, use_case, gateway_template_id, sender_id, route, message_type, category,
   body_template, variables, status, is_active, auto_send_enabled, trigger_event, audience_type, updated_at)
values
  ('notes_order_confirmed_01', 'NOTES_ORDER_CONFIRMED_01', 'PAYMENT', '1777179058711611732', 'NAMIAS', '12', 'service', 'transactional',
   'Thank you! Your {#alp#} Notes order is confirmed. Rs.{#num#} payment received. Track: {#urg#} Naman Sharma IAS Academy.',
   array['#alp#','#num#','#urg#'], 'active', true, false, 'notes_order_confirmed', 'notes_store', now()),
  ('notes_payment_pending_01', 'NOTES_PAYMENT_PENDING_01', 'PAYMENT', '1777179057396343991', 'NAMIAS', '12', 'service', 'transactional',
   'Your {#alp#} Notes order is saved, but payment of Rs.{#num#} is pending. Complete payment: {#urg#} Naman Sharma IAS Academy.',
   array['#alp#','#num#','#urg#'], 'active', true, false, 'notes_payment_pending', 'notes_store', now()),
  ('notes_checkout_incomplete_01', 'NOTES_CHECKOUT_INCOMPLETE_01', 'PAYMENT', '1777179058827172599', 'NAMIAS', '12', 'service', 'transactional',
   U&'Your order for Naman Sir\2019s handwritten UPSC Notes is currently pending. View your order details here: {#urg#} Naman Sharma IAS Academy.',
   array['#urg#'], 'active', true, false, 'notes_checkout_incomplete', 'notes_store', now()),
  ('notes_new_lead_promo_01', 'NOTES_NEW_LEAD_PROMO_01', 'ONBOARDING', '1777179057434102445', 'NAMIAS', '12', 'promotional', 'promo',
   U&'Naman Sir\2019s handwritten UPSC Notes are now available in print. Get copies delivered to your home. Order: {#urg#} Naman Sharma IAS Academy.',
   array['#urg#'], 'active', true, false, 'notes_new_lead_promo', 'notes_store', now()),
  ('notes_discount_notes500_01', 'NOTES_DISCOUNT_NOTES500_01', 'ONBOARDING', '1777179057448502622', 'NAMIAS', '12', 'promotional', 'promo',
   U&'Special offer: Get Rs.500 off Naman Sir\2019s handwritten UPSC Notes. Use code NOTES500. Order: {#urg#} Naman Sharma IAS Academy.',
   array['#urg#'], 'active', true, false, 'notes_discount_notes500', 'notes_store', now())
on conflict (id) do update set
  name = excluded.name,
  use_case = excluded.use_case,
  gateway_template_id = excluded.gateway_template_id,
  sender_id = excluded.sender_id,
  route = excluded.route,
  message_type = excluded.message_type,
  category = excluded.category,
  body_template = excluded.body_template,
  variables = excluded.variables,
  status = excluded.status,
  is_active = excluded.is_active,
  auto_send_enabled = false,
  trigger_event = excluded.trigger_event,
  audience_type = excluded.audience_type,
  updated_by = 'notes_sms_approved_import',
  updated_at = now();

insert into public.sms_auto_rules (trigger, template_id, enabled, delay_minutes, audience_type)
values
  ('notes_order_confirmed', 'notes_order_confirmed_01', false, null, 'notes_store'),
  ('notes_payment_pending', 'notes_payment_pending_01', false, 60, 'notes_store'),
  ('notes_checkout_incomplete', 'notes_checkout_incomplete_01', false, null, 'notes_store'),
  ('notes_new_lead_promo', 'notes_new_lead_promo_01', false, null, 'notes_store')
on conflict (trigger) do nothing;

-- Read-back: every row must report body_ok = true.
-- select id, gateway_template_id, category, message_type,
--   body_template = case id
--     when 'notes_order_confirmed_01' then 'Thank you! Your {#alp#} Notes order is confirmed. Rs.{#num#} payment received. Track: {#urg#} Naman Sharma IAS Academy.'
--     when 'notes_payment_pending_01' then 'Your {#alp#} Notes order is saved, but payment of Rs.{#num#} is pending. Complete payment: {#urg#} Naman Sharma IAS Academy.'
--     when 'notes_checkout_incomplete_01' then U&'Your order for Naman Sir\2019s handwritten UPSC Notes is currently pending. View your order details here: {#urg#} Naman Sharma IAS Academy.'
--     when 'notes_new_lead_promo_01' then U&'Naman Sir\2019s handwritten UPSC Notes are now available in print. Get copies delivered to your home. Order: {#urg#} Naman Sharma IAS Academy.'
--     when 'notes_discount_notes500_01' then U&'Special offer: Get Rs.500 off Naman Sir\2019s handwritten UPSC Notes. Use code NOTES500. Order: {#urg#} Naman Sharma IAS Academy.'
--   end as body_ok
-- from public.sms_templates where id like 'notes\_%' order by id;
