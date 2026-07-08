-- ============================================================
-- Grant the new `content_resources` permission to roles that already
-- manage content. Additive & idempotent — safe to re-run.
-- ============================================================

-- Any role that can manage Current Affairs (or all content) also manages the
-- UPSC Resources hub by default. Super Admins already get everything at runtime.
update public.roles
set permissions = permissions || '{"content_resources":true}'::jsonb,
    updated_at = now()
where (permissions ? 'content_current_affairs')
   or id in ('super_admin', 'admin', 'content_admin', 'content_editor', 'current_affairs_editor');
