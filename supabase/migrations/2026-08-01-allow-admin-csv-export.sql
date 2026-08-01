alter table public.site_settings add column if not exists allow_admin_csv_export boolean not null default false;
