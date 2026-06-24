-- Part B (Student CRM): record the payment method on receipts so cash/offline
-- payments display "Cash" / "Bank Transfer" / "Offline UPI". Nullable + backward
-- compatible (existing online receipts simply have NULL).
alter table public.payment_receipts add column if not exists method text;

-- Optional internal admin notes on a student (Part B add/edit student).
alter table public.students add column if not exists notes text;
