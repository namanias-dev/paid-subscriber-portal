-- ============================================================================
-- Migration: rich content, media, coupons, visibility (Tasks 3–8)
-- Safe to run on an existing database. Idempotent.
-- Run this in the Supabase SQL Editor.
-- ============================================================================

-- ---- Courses: cover images, rich content, coupons, visibility ----
alter table public.courses add column if not exists cover_image_url text;
alter table public.courses add column if not exists mobile_image_url text;
alter table public.courses add column if not exists faqs jsonb default '[]'::jsonb;
alter table public.courses add column if not exists contact_links jsonb default '[]'::jsonb;
alter table public.courses add column if not exists pdf_resources jsonb default '[]'::jsonb;
alter table public.courses add column if not exists coupons jsonb default '[]'::jsonb;
alter table public.courses add column if not exists active boolean default true;

-- ---- Webinars: end time, rich content, media, coupons, visibility ----
alter table public.webinars add column if not exists end_datetime timestamptz;
alter table public.webinars add column if not exists long_description text;
alter table public.webinars add column if not exists cover_image_url text;
alter table public.webinars add column if not exists mobile_image_url text;
alter table public.webinars add column if not exists faqs jsonb default '[]'::jsonb;
alter table public.webinars add column if not exists contact_links jsonb default '[]'::jsonb;
alter table public.webinars add column if not exists pdf_resources jsonb default '[]'::jsonb;
alter table public.webinars add column if not exists coupons jsonb default '[]'::jsonb;
alter table public.webinars add column if not exists active boolean default true;

-- ---- Storage: public 'media' bucket for cover images + PDF resources ----
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

-- Public read access to objects in the 'media' bucket.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Public read media'
  ) then
    create policy "Public read media" on storage.objects
      for select using (bucket_id = 'media');
  end if;
end $$;
