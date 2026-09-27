import { LOCAL_FIXTURE_ORDER_ID, localFixtureEnabled, resetLocalFixture } from "@/lib/store/localFixture";
import { ensureStoreInvoice } from "@/lib/store/invoice/issue";
import { noStoreJson } from "@/lib/store/http";

export const dynamic = "force-dynamic";

/** Issues the in-memory TEST invoice. Absent on Vercel and in production. */
export async function POST() {
  if (!localFixtureEnabled()) return noStoreJson({ ok: false, error: "not found" }, 404);
  resetLocalFixture();
  const result = await ensureStoreInvoice(LOCAL_FIXTURE_ORDER_ID, { namespace: "test" });
  const { storeDb } = await import("@/lib/store/db");
  const { data } = await storeDb()!.from("store_invoices").select("attention,status").eq("order_id", LOCAL_FIXTURE_ORDER_ID).maybeSingle();
  return noStoreJson({ ok: result.ok, status: result.status, invoiceNumber: result.invoiceNumber, attention: data?.attention || null });
}
