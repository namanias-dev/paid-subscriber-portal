-- Payment settlement state for ICICI Eazypay Verify URL results.
--
-- RIP (Reconciliation In Progress) and SIP (Settlement In Progress) both mean
-- the money was GENUINELY received from the payer's bank but has not yet settled
-- into our merchant account. We treat them as PAID (course access is granted),
-- but Finance still needs to see that settlement is pending — that is what this
-- column records:
--   'settled'      -> money in our merchant account (ICICI status Success)
--   'in_progress'  -> money confirmed, still reconciling/settling (RIP / SIP)
--   NULL           -> non-paid row, or settlement state unknown
--
-- Purely additive; nullable; never backfilled destructively. Existing PAID rows
-- simply have NULL until the next successful Verify URL check stamps them.

alter table public.payments
  add column if not exists settlement_status text;

comment on column public.payments.settlement_status is
  'ICICI Verify settlement state for a PAID row: settled | in_progress | null.';
