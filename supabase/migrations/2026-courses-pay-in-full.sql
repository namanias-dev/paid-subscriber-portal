-- Courses: add optional one-shot "Pay-in-Full" discounted price.
-- The standard `price` remains the base used for EMI / Book-Your-Seat plans.
-- `pay_in_full_price`, when set (> 0), is the discounted total charged ONLY when
-- the student chooses to pay the whole fee in one go.
alter table public.courses
  add column if not exists pay_in_full_price numeric;

-- Note: the legacy `emi_amount` / `emi_months` columns are now unused (EMI is
-- auto-calculated at checkout from `emi_config`). They are intentionally left in
-- place so existing rows and any historical reporting are not disturbed.
