-- Immutable, append-only audit log for staff/super-admin payment actions:
-- proof uploads, approvals, rejections, re-upload requests, notes and reversals.
-- Powers (a) the super-admin Accountability report (who uploaded/approved how
-- many) and (b) per-payment lifecycle history (uploaded by X -> approved by Y ->
-- reversed by Z, with reasons + times). This is SEPARATE from payment_proofs.audit
-- (which is per-proof and student-facing); this table is the org-wide ledger.
--
-- Append-only by convention: the app only ever INSERTs and SELECTs. RLS is enabled
-- with NO policies, so anon/authed clients get zero rows and zero writes — only the
-- service-role key (server-side) can read/write, exactly like payment_proofs.
create table if not exists public.payment_action_log (
  id text primary key,
  -- proof_upload | approve | reject | reupload_request | note | reverse
  action text not null,
  payment_id text,
  reference_no text,
  enrollment_id text,
  student_id text,
  phone text,
  -- actor identity (admin account that performed the action)
  actor_id text,
  actor_name text,
  actor_role text,
  actor_is_super boolean not null default false,
  -- payment status transition captured at action time
  old_status text,
  new_status text,
  -- required for reversals; optional note otherwise
  reason text,
  -- proof file references at upload time: [{key,name,content_type,size,uploaded_at}]
  files jsonb not null default '[]'::jsonb,
  file_count int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pal_payment_idx on public.payment_action_log (payment_id);
create index if not exists pal_actor_idx on public.payment_action_log (actor_id);
create index if not exists pal_action_idx on public.payment_action_log (action);
create index if not exists pal_created_idx on public.payment_action_log (created_at);

alter table public.payment_action_log enable row level security;
