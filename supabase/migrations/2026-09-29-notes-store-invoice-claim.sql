-- Notes Store: one invoice per captured order, numbered in the same transaction.
--
-- Additive only. The existing next_store_invoice_seq and store_invoices rows are
-- unchanged. The per-order advisory lock serialises concurrent issuers (payment
-- capture, cron repair, admin retry). The counter increment and the insert
-- commit together, so a failed insert rolls the number back instead of leaving
-- a gap, and an order that already has an invoice returns its existing number.

create or replace function public.claim_store_invoice(
  p_order_id uuid,
  p_namespace text,
  p_fy text,
  p_prefix text,
  p_row jsonb
)
returns table (invoice_number text, status text, created boolean)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  v_seq integer;
  v_prefix text;
  v_number text;
  r public.store_invoices%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('store_invoice:' || p_order_id::text, 0));

  return query
    select i.invoice_number, i.status, false
    from public.store_invoices i
    where i.order_id = p_order_id;
  if found then
    return;
  end if;

  v_seq := public.next_store_invoice_seq(p_namespace, p_fy);
  v_prefix := coalesce(nullif(left(regexp_replace(coalesce(p_prefix, ''), '[^A-Za-z0-9]', '', 'g'), 8), ''), 'NIA');
  v_number := v_prefix || '/' || p_fy || '/' ||
    case when length(v_seq::text) >= 5 then v_seq::text else lpad(v_seq::text, 5, '0') end;

  r := jsonb_populate_record(null::public.store_invoices, p_row);

  insert into public.store_invoices (
    order_id, invoice_number, financial_year, sequence_number, namespace,
    document_type, status, attention,
    seller_snapshot, buyer_snapshot, shipping_snapshot, line_items_snapshot, tax_summary,
    subtotal_minor, discount_minor, shipping_minor, taxable_minor,
    cgst_minor, sgst_minor, utgst_minor, igst_minor, rounding_minor, grand_total_minor,
    place_of_supply_state, place_of_supply_state_code,
    payment_gateway, gateway_transaction_id, gateway_reference, paid_at
  ) values (
    p_order_id, v_number, p_fy, v_seq, p_namespace,
    r.document_type, 'PENDING', r.attention,
    coalesce(r.seller_snapshot, '{}'::jsonb), coalesce(r.buyer_snapshot, '{}'::jsonb),
    coalesce(r.shipping_snapshot, '{}'::jsonb), coalesce(r.line_items_snapshot, '[]'::jsonb),
    coalesce(r.tax_summary, '{}'::jsonb),
    coalesce(r.subtotal_minor, 0), coalesce(r.discount_minor, 0), coalesce(r.shipping_minor, 0),
    coalesce(r.taxable_minor, 0), coalesce(r.cgst_minor, 0), coalesce(r.sgst_minor, 0),
    coalesce(r.utgst_minor, 0), coalesce(r.igst_minor, 0), coalesce(r.rounding_minor, 0),
    coalesce(r.grand_total_minor, 0),
    r.place_of_supply_state, r.place_of_supply_state_code,
    r.payment_gateway, r.gateway_transaction_id, r.gateway_reference, r.paid_at
  );

  return query select v_number, 'PENDING'::text, true;
end;
$$;

revoke all on function public.claim_store_invoice(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_store_invoice(uuid, text, text, text, jsonb) to service_role;
