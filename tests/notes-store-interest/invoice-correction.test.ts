import assert from "node:assert/strict";
import test from "node:test";

process.env.NOTES_STORE_LOCAL_FIXTURE = "1";
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("a clerical correction rewrites the PDF without a new invoice number", async () => {
  const { LOCAL_FIXTURE_ORDER_ID, resetLocalFixture } = await import("../../lib/store/localFixture");
  const { ensureStoreInvoice } = await import("../../lib/store/invoice/issue");
  const { correctInvoiceSellerDisplay } = await import("../../lib/store/invoice/correct");
  const { deleteObject } = await import("../../lib/r2");
  const { storeDb } = await import("../../lib/store/db");
  resetLocalFixture();
  const db = storeDb()!;
  const issued = await ensureStoreInvoice(LOCAL_FIXTURE_ORDER_ID, { namespace: "test" });
  assert.equal(issued.ok, true);
  const { data: before } = await db.from("store_invoices").select("invoice_number,issued_at,grand_total_minor,sequence_number,r2_object_key,seller_snapshot").eq("order_id", LOCAL_FIXTURE_ORDER_ID).maybeSingle();
  const refused = await correctInvoiceSellerDisplay(before!.invoice_number, { logoPng: new Uint8Array(PNG) });
  assert.equal(refused.ok, false);
  await db.from("store_invoice_settings").update({
    legal_name: "NAMAN SHARMA",
    trade_name: "NAMAN SHARMA IAS ACADEMY",
    display_name: "NAMAN SHARMA IAS ACADEMY",
    gstin: "04CDVPS5346D2Z6",
    state_code: "04",
    address_floor_display: "Second Floor",
    address_floor_raw: "SECOUND FLOOR",
    address_line: "SCO-173-174",
    address_sector: "17C",
    city: "CHANDIGARH",
    state: "CHANDIGARH",
    pincode: "160030",
  }).eq("id", 1);
  const corrected = await correctInvoiceSellerDisplay(before!.invoice_number, { logoPng: new Uint8Array(PNG) });
  assert.equal(corrected.ok, true);
  assert.equal(corrected.invoiceNumber, before!.invoice_number);
  const { data: rows } = await db.from("store_invoices").select("invoice_number,issued_at,grand_total_minor,discount_minor,shipping_minor,sequence_number,pdf_version,pdf_revision_reason,previous_pdf_sha256,previous_pdf_object_key,seller_snapshot,seller_snapshot_original,pdf_sha256").eq("order_id", LOCAL_FIXTURE_ORDER_ID);
  assert.equal(rows?.length, 1);
  const after = rows![0];
  assert.equal(after.invoice_number, before!.invoice_number);
  assert.equal(after.issued_at, before!.issued_at);
  assert.equal(after.grand_total_minor, before!.grand_total_minor);
  assert.equal(after.sequence_number, 1);
  assert.equal(after.pdf_version, 2);
  assert.match(after.seller_snapshot.address, /Second Floor, SCO-173-174/);
  assert.match(after.seller_snapshot.address, /160030/);
  assert.equal(String(after.seller_snapshot.address).includes("SECOUND"), false);
  assert.equal(after.seller_snapshot_original.address, before!.seller_snapshot.address);
  assert.equal(after.previous_pdf_sha256, corrected.previousSha);
  assert.notEqual(after.pdf_sha256, after.previous_pdf_sha256);
  const { data: counter } = await db.from("store_invoice_counters").select("last_value").eq("namespace", "test");
  assert.equal(counter?.[0].last_value, 1);
  assert.equal(await deleteObject(before!.r2_object_key), true);
  assert.equal(await deleteObject(after.previous_pdf_object_key), true);
  resetLocalFixture();
});
