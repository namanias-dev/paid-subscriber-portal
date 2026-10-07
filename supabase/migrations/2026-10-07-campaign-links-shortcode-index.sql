-- Campaign Links: plain btree index on short_code for the public redirect lookup.
--
-- ADDITIVE + IDEMPOTENT. The existing unique index is on `lower(short_code)`,
-- which Postgres cannot use for an equality probe on the raw column. The redirect
-- (`resolveCampaignLinkByCode`) matches the already-normalised (lower-cased) code
-- with `short_code = $1`, so a plain index on `short_code` makes that an index
-- scan instead of a sequential scan under ad traffic. The functional unique index
-- stays in place to enforce case-insensitive uniqueness.
create index if not exists idx_campaign_links_short_code_exact
  on public.campaign_links (short_code);
