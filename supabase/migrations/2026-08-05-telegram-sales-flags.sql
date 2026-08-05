-- Sales Telegram kill switches (toggle without deploy).
insert into public.app_feature_flags (key, enabled, scope, kill_switch, meta)
values
  ('sales_alerts_enabled', true, 'all', false, '{"note":"Telegram sales instant alerts"}'::jsonb),
  ('sales_digest_enabled', true, 'all', false, '{"note":"Telegram sales 10/15/20 IST digest"}'::jsonb)
on conflict (key) do nothing;
