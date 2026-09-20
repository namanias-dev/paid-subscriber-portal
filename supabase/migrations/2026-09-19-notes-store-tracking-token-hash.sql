-- Notes Store: persist only a one-way hash of the order access token.
-- Additive. Clears plaintext tracking_token. App code writes tracking_token_hash
-- with a peppered SHA-256; operators re-issue via phone track if an old plaintext
-- token is wiped without a matching hash.

alter table public.store_orders
  add column if not exists tracking_token_hash text;

create unique index if not exists store_orders_tracking_token_hash_uq
  on public.store_orders (tracking_token_hash)
  where tracking_token_hash is not null;

-- Wipe any plaintext capability that may exist in lower environments.
update public.store_orders
set tracking_token = null
where tracking_token is not null;

comment on column public.store_orders.tracking_token_hash is
  'SHA-256 hex of peppered access token. Raw token never stored. Capability via cookie or ?t=.';

comment on column public.store_orders.tracking_token is
  'DEPRECATED — always null. Kept for schema compatibility; do not write.';
