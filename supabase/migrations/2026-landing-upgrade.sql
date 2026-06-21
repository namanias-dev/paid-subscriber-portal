-- ============================================================================
-- Migration: premium course/webinar landing upgrade
-- Adds seats, WhatsApp/contact, rich About HTML, video, mentor, SEO, reviews,
-- learn/audience lists and flexible sections. Safe to run on an existing DB.
-- Idempotent. Run this in the Supabase SQL Editor.
-- ============================================================================

-- ---- Courses ----
alter table public.courses add column if not exists about_html text;
alter table public.courses add column if not exists badge_label text;
alter table public.courses add column if not exists seat_config jsonb default '{}'::jsonb;
alter table public.courses add column if not exists whatsapp_config jsonb default '{}'::jsonb;
alter table public.courses add column if not exists video_config jsonb default '{}'::jsonb;
alter table public.courses add column if not exists mentor jsonb default '{}'::jsonb;
alter table public.courses add column if not exists seo jsonb default '{}'::jsonb;
alter table public.courses add column if not exists what_you_learn jsonb default '[]'::jsonb;
alter table public.courses add column if not exists who_should_attend jsonb default '[]'::jsonb;
alter table public.courses add column if not exists what_you_get jsonb default '[]'::jsonb;
alter table public.courses add column if not exists reviews jsonb default '[]'::jsonb;
alter table public.courses add column if not exists sections jsonb default '[]'::jsonb;

-- ---- Webinars ----
alter table public.webinars add column if not exists about_html text;
alter table public.webinars add column if not exists badge_label text;
alter table public.webinars add column if not exists seat_config jsonb default '{}'::jsonb;
alter table public.webinars add column if not exists whatsapp_config jsonb default '{}'::jsonb;
alter table public.webinars add column if not exists video_config jsonb default '{}'::jsonb;
alter table public.webinars add column if not exists mentor jsonb default '{}'::jsonb;
alter table public.webinars add column if not exists seo jsonb default '{}'::jsonb;
alter table public.webinars add column if not exists what_you_learn jsonb default '[]'::jsonb;
alter table public.webinars add column if not exists who_should_attend jsonb default '[]'::jsonb;
alter table public.webinars add column if not exists what_you_get jsonb default '[]'::jsonb;
alter table public.webinars add column if not exists reviews jsonb default '[]'::jsonb;
alter table public.webinars add column if not exists sections jsonb default '[]'::jsonb;
