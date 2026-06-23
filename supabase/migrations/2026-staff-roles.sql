-- ============================================================
-- Staff & Roles (RBAC) — admin-created logins with granular permissions
-- Idempotent & backward-compatible.
-- ============================================================

-- ------------------------------- roles ------------------------------
create table if not exists public.roles (
  id text primary key,
  name text not null,
  description text,
  permissions jsonb not null default '{}'::jsonb,
  is_system boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ------------------- admin_users: enrich into staff-login accounts -------------------
alter table public.admin_users add column if not exists name text;
alter table public.admin_users add column if not exists email text;
alter table public.admin_users add column if not exists role_id text references public.roles(id);
alter table public.admin_users add column if not exists status text not null default 'active';
alter table public.admin_users add column if not exists must_change_password boolean not null default false;
alter table public.admin_users add column if not exists permissions_override jsonb;
alter table public.admin_users add column if not exists created_by text;
alter table public.admin_users add column if not exists last_login_at timestamptz;

-- Seed / refresh the canonical system roles (permissions kept in sync on re-run).
insert into public.roles (id, name, description, permissions, is_system) values
  ('super_admin', 'Super Admin', 'Full, unrestricted access to everything including staff, roles, revenue and settings.',
   '{"manage_staff":true,"manage_roles":true,"view_revenue":true,"manage_payments":true,"manage_pricing":true,"manage_settings":true,"content_courses":true,"content_webinars":true,"content_quizzes":true,"content_current_affairs":true,"content_pdfs_media":true,"manage_seo":true,"publish_content":true,"manage_students_leads":true,"view_analytics_nonrevenue":true,"view_analytics_revenue":true,"manage_integrations":true}'::jsonb, true),
  ('admin', 'Admin', 'Full operational access including revenue, but cannot manage Super Admins or the role matrix.',
   '{"manage_staff":true,"manage_roles":false,"view_revenue":true,"manage_payments":true,"manage_pricing":true,"manage_settings":true,"content_courses":true,"content_webinars":true,"content_quizzes":true,"content_current_affairs":true,"content_pdfs_media":true,"manage_seo":true,"publish_content":true,"manage_students_leads":true,"view_analytics_nonrevenue":true,"view_analytics_revenue":true,"manage_integrations":true}'::jsonb, true),
  ('content_admin', 'Content Admin', 'Full access to ALL content and general settings — but NO revenue or financial data.',
   '{"content_courses":true,"content_webinars":true,"content_quizzes":true,"content_current_affairs":true,"content_pdfs_media":true,"manage_seo":true,"publish_content":true,"manage_settings":true,"manage_students_leads":true,"view_analytics_nonrevenue":true}'::jsonb, true),
  ('content_editor', 'Content Editor', 'Create, edit and publish content only. No settings, staff or revenue.',
   '{"content_courses":true,"content_webinars":true,"content_quizzes":true,"content_current_affairs":true,"content_pdfs_media":true,"manage_seo":true,"publish_content":true}'::jsonb, true),
  ('current_affairs_editor', 'Current Affairs Editor', 'Only the Current Affairs module — articles, daily/monthly, PDFs, CA categories & tags.',
   '{"content_current_affairs":true,"content_pdfs_media":true,"publish_content":true,"view_analytics_nonrevenue":true}'::jsonb, true),
  ('support_ops', 'Support / Operations', 'View and respond to students & leads, manage enrollments. No publishing, revenue or staff.',
   '{"manage_students_leads":true,"view_analytics_nonrevenue":true}'::jsonb, true),
  ('finance', 'Finance / Revenue', 'Revenue dashboards, payments, payouts and invoices only. No content, staff or settings.',
   '{"view_revenue":true,"manage_payments":true,"manage_pricing":true,"view_analytics_revenue":true,"view_analytics_nonrevenue":true}'::jsonb, true),
  ('viewer', 'Viewer / Analyst', 'Read-only across allowed modules. No edits and no revenue unless explicitly granted.',
   '{"view_analytics_nonrevenue":true}'::jsonb, true)
on conflict (id) do update
  set name = excluded.name,
      description = excluded.description,
      permissions = excluded.permissions,
      is_system = true,
      updated_at = now();

-- Backfill existing admin accounts → Super Admin (preserves current full access).
update public.admin_users set status = 'active' where status is null;
update public.admin_users set role_id = 'super_admin'
  where role_id is null and (role = 'Super Admin' or role is null);
update public.admin_users set role_id = 'admin' where role_id is null and role = 'Admin';

-- RLS: roles are managed only via the service role (admin API). No anon access.
alter table public.roles enable row level security;
