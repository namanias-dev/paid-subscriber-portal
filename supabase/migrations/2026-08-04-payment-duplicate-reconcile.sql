-- Additive, reversible: link a redundant PAID row to the kept gateway-truth PAID
-- row without changing status (trg_payments_prevent_paid_downgrade stays intact).
-- Nullable; no backfill required; safe to drop columns later if unused.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS duplicate_of_payment_id text NULL REFERENCES payments(id),
  ADD COLUMN IF NOT EXISTS duplicate_reconciled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS duplicate_reconcile_reason text NULL;

CREATE INDEX IF NOT EXISTS payments_duplicate_of_payment_id_idx
  ON payments (duplicate_of_payment_id)
  WHERE duplicate_of_payment_id IS NOT NULL;

COMMENT ON COLUMN payments.duplicate_of_payment_id IS
  'Reconcile link: this PAID row is a redundant duplicate of another PAID row (e.g. proof approval vs ICICI gateway). Status remains PAID.';
