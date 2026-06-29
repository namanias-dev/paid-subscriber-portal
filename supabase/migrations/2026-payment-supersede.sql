-- ============================================================
-- Payment supersession — canonical group status, paid-wins.
--
-- PROBLEM: when a student has several attempts for the SAME item+purpose
-- (e.g. webinar paid once but retried twice → VERIFYING + PAID + VERIFYING),
-- the Finance UI surfaced the newest attempt's status, so a PAID/approved
-- group could be mislabelled VERIFYING and look like it "needs action".
--
-- FIX (additive & safe): the attempt's real status (PAID/PENDING/VERIFYING/
-- FAILED/ABANDONED + proof states) is NEVER changed. Instead we flag the
-- now-moot unpaid attempts in a paid group as SUPERSEDED. We deliberately do
-- NOT introduce a new "SUPERSEDED" payment status enum — that would break the
-- existing callback / access / installment / SMS / filter logic that switches
-- on status. These are plain boolean/pointer columns.
--
-- Canonical group status is then DERIVED at read time (paid > verifying >
-- pending > abandoned > failed), so it self-corrects when a late gateway
-- callback or a manual approval lands.
--
-- Service-role-only: payments already has RLS with no client policies; these
-- columns inherit that. Only getSupabaseAdmin (server) reads/writes them.
-- ============================================================

alter table public.payments add column if not exists is_superseded boolean not null default false;
alter table public.payments add column if not exists superseded_by_payment_id text;
alter table public.payments add column if not exists superseded_at timestamptz;
alter table public.payments add column if not exists superseded_reason text;

-- Fast lookup of a phone's open (non-superseded, live) attempts and of every
-- attempt a given paid row superseded.
create index if not exists payments_is_superseded_idx on public.payments (is_superseded);
create index if not exists payments_superseded_by_idx on public.payments (superseded_by_payment_id);

notify pgrst, 'reload schema';
