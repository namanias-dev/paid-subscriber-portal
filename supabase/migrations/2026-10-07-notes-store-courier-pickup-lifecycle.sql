-- Courier pickup lifecycle on the shipment.
--
-- Additive only. The store overloads store_shipments.status for the shipment/AWB
-- lifecycle; these columns add the separate COURIER PICKUP REQUEST lifecycle so a
-- provider-side pickup cancellation can be told apart from a shipment cancellation
-- and reconciled into admin without walking a possessed order backwards.
--
-- Every column is nullable or defaulted, so historical shipments read as
-- NOT_REQUESTED with no backfill. store_shipment_events already carries the audit
-- trail (source + payload), so no new event table is needed.
--
-- Service role only (RLS stays on, no policies), same as the rest of the store.

begin;

alter table public.store_shipments
  add column if not exists pickup_state text not null default 'NOT_REQUESTED',
  add column if not exists pickup_requested_date date,
  add column if not exists pickup_confirmed_date date,
  add column if not exists pickup_slot text,
  add column if not exists pickup_request_id text,
  add column if not exists pickup_cancelled_at timestamptz,
  add column if not exists pickup_cancel_reason text,
  add column if not exists pickup_last_synced_at timestamptz,
  -- Where the current pickup_state came from: BOOKING_RESPONSE | WEBHOOK | RECONCILIATION | MANUAL_REFRESH | STAFF_ACTION.
  add column if not exists pickup_status_source text,
  -- Minimal provider evidence; never the full payload (no PII/secrets).
  add column if not exists provider_pickup_status text,
  add column if not exists provider_pickup_status_at timestamptz;

alter table public.store_shipments drop constraint if exists store_shipments_pickup_state_check;
alter table public.store_shipments add constraint store_shipments_pickup_state_check
  check (pickup_state in ('NOT_REQUESTED', 'REQUESTED', 'SCHEDULED', 'CANCELLED', 'FAILED', 'PICKED_UP'));

alter table public.store_shipments drop constraint if exists store_shipments_pickup_status_source_check;
alter table public.store_shipments add constraint store_shipments_pickup_status_source_check
  check (
    pickup_status_source is null
    or pickup_status_source in ('BOOKING_RESPONSE', 'WEBHOOK', 'RECONCILIATION', 'MANUAL_REFRESH', 'STAFF_ACTION')
  );

-- Find shipments whose pickup is cancelled/failed and needs staff action, or that are
-- still pre-possession and may need a provider status read. Partial index keeps it small.
create index if not exists store_shipments_pickup_attention_idx
  on public.store_shipments (pickup_state, pickup_last_synced_at)
  where pickup_state in ('REQUESTED', 'SCHEDULED', 'CANCELLED', 'FAILED');

comment on column public.store_shipments.pickup_state is
  'Courier pickup request lifecycle, separate from status (the shipment/AWB lifecycle). See lib/store/shipping/pickup.ts.';
comment on column public.store_shipments.provider_pickup_status is
  'Last raw provider pickup status string (sanitized, truncated). Evidence only; business logic uses pickup_state.';

commit;
