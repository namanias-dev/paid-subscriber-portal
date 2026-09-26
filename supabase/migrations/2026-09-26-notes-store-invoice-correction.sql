alter table public.store_invoices
  add column if not exists pdf_revision_reason text,
  add column if not exists pdf_regenerated_at timestamptz,
  add column if not exists previous_pdf_sha256 text,
  add column if not exists previous_pdf_object_key text,
  add column if not exists previous_pdf_size integer,
  add column if not exists previous_pdf_generated_at timestamptz,
  add column if not exists seller_snapshot_original jsonb,
  add column if not exists seller_display_correction jsonb;
