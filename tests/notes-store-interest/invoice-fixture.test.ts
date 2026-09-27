import assert from "node:assert/strict";
import test from "node:test";

process.env.NOTES_STORE_LOCAL_FIXTURE = "1";
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;

test("a local fixture issues one TEST invoice and a second call keeps it", async () => {
  const { LOCAL_FIXTURE_ORDER_ID, resetLocalFixture } = await import("../../lib/store/localFixture");
  const { ensureStoreInvoice } = await import("../../lib/store/invoice/issue");
  const { deleteObject, getObject } = await import("../../lib/r2");
  resetLocalFixture();
  const first = await ensureStoreInvoice(LOCAL_FIXTURE_ORDER_ID, { namespace: "test" });
  assert.equal(first.ok, true);
  assert.equal(first.status, "READY");
  assert.match(first.invoiceNumber || "", /^TEST\/\d\d-\d\d\/00001$/);
  const second = await ensureStoreInvoice(LOCAL_FIXTURE_ORDER_ID, { namespace: "test" });
  assert.equal(second.invoiceNumber, first.invoiceNumber);
  assert.equal(second.status, "READY");
  const { storeDb } = await import("../../lib/store/db");
  const db = storeDb();
  const { data } = await db!.from("store_invoices").select("invoice_number,r2_object_key,grand_total_minor").eq("order_id", LOCAL_FIXTURE_ORDER_ID);
  assert.equal(data?.length, 1);
  assert.equal(data?.[0].grand_total_minor, 249820);
  const key = data?.[0].r2_object_key as string;
  assert.match(key, /^invoices\/FY/);
  const obj = await getObject(key);
  assert.ok(obj);
  assert.equal(obj?.contentType, "application/pdf");
  const removed = await deleteObject(key);
  assert.equal(removed, true);
  resetLocalFixture();
});
