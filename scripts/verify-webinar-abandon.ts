/**
 * DB-verified test for the webinar abandoned-checkout state machine.
 *
 * Exercises the SAME shared functions the app uses (no forked logic):
 *   - abandonEvidencelessOpenPayments  (expiry engine, course + webinar)
 *   - getWebinarPaymentStatusMap       (student access gating)
 *   - getWebinarPaymentStatusesForSlug (admin registrations view)
 *
 * Inserts ONE synthetic evidence-less INITIATED webinar attempt, asserts it
 * grants NO access and reads as "not paid", runs the expiry sweep, asserts it
 * becomes ABANDONED (still no access, retry-able), then DELETES the test row.
 *
 * Read-only against real data; only its own synthetic row is written + removed.
 *   node --env-file=.env.local --import tsx scripts/verify-webinar-abandon.ts
 */
import {
  abandonEvidencelessOpenPayments,
  getWebinarPaymentStatusMap,
  getWebinarPaymentStatusesForSlug,
} from "../lib/dataProvider";
import { getSupabaseAdmin } from "../lib/supabase";

const SLUG = "upsc-cse-masterclass";
const PHONE = "9990000009"; // synthetic test phone, never a real student
const ID = `test-webinar-abandon-${Date.now()}`;
const REF = `TESTWEB${Date.now()}`;

let pass = true;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) pass = false;
};

async function main() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("No Supabase admin client (check .env.local).");

  // Backdate 2h so it's past the 30-min abandon window immediately.
  const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  console.log("1) Insert synthetic INITIATED webinar attempt (evidence-less)…");
  const { error: insErr } = await db.from("payments").insert({
    id: ID,
    student_name: "TEST Abandon",
    phone: PHONE,
    item: "TEST Webinar",
    item_type: "webinar",
    item_slug: SLUG,
    amount: 50,
    status: "INITIATED",
    reference_no: REF,
    payment_kind: "full",
    created_at: createdAt,
  });
  if (insErr) throw new Error(`insert failed: ${insErr.message}`);

  console.log("2) Access gating while INITIATED…");
  const map1 = await getWebinarPaymentStatusMap(PHONE);
  check("student has NO webinar access on INITIATED", map1.get(SLUG) === undefined, `map=${map1.get(SLUG) ?? "none"}`);
  const admin1 = await getWebinarPaymentStatusesForSlug(SLUG);
  check("admin does NOT see INITIATED as paid/pending (reads unpaid)", admin1.get(PHONE) === undefined, `admin=${admin1.get(PHONE) ?? "unpaid"}`);

  console.log("3) Run shared expiry sweep (phones-scoped)…");
  const sweep = await abandonEvidencelessOpenPayments({ phones: [PHONE] });
  check("sweep abandoned exactly this attempt", sweep.abandoned === 1 && sweep.referenceNos.includes(REF), `abandoned=${sweep.abandoned}`);

  console.log("4) State + access after abandonment…");
  const { data: after } = await db.from("payments").select("status").eq("id", ID).single();
  check("row is now ABANDONED", (after as { status?: string } | null)?.status === "ABANDONED", `status=${(after as { status?: string } | null)?.status}`);
  const map2 = await getWebinarPaymentStatusMap(PHONE);
  check("still NO access after ABANDONED (retry-able, not paid)", map2.get(SLUG) !== "PAID", `map=${map2.get(SLUG) ?? "none"}`);
  const admin2 = await getWebinarPaymentStatusesForSlug(SLUG);
  check("admin reads ABANDONED as FAILED/retry (not confirmed)", admin2.get(PHONE) === "FAILED", `admin=${admin2.get(PHONE) ?? "unpaid"}`);

  console.log("5) Cleanup synthetic row…");
  const { error: delErr } = await db.from("payments").delete().eq("id", ID);
  check("test row deleted", !delErr, delErr?.message);

  console.log(`\n${pass ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}`);
  process.exit(pass ? 0 : 1);
}

main().catch(async (e) => {
  console.error("ERROR:", e.message);
  // Best-effort cleanup on failure.
  try {
    const db = getSupabaseAdmin();
    if (db) await db.from("payments").delete().eq("id", ID);
  } catch { /* ignore */ }
  process.exit(1);
});
