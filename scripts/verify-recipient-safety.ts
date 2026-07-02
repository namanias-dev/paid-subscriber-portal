/**
 * Self-cleaning DB test for the identity-safe recipient resolution (Issue 2).
 * NOTE: buyers.phone is UNIQUE (buyers_phone_key), so two buyers can't share a
 * number at the DB layer — the live risk is a NAME/record mismatch (the buyer on
 * a number differs from the payment/registration name we address). This asserts
 * the REAL path withholds the login_code on a name mismatch and attaches it only
 * when names agree. Uses ONLY a synthetic 90000000xx number — never a student.
 *   node --env-file=.env.local --import tsx scripts/verify-recipient-safety.ts
 */
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "../lib/supabase";
import { resolveAudience } from "../lib/sms/audiences";
import { resolveBuyerByPhone } from "../lib/sms/store";

const SINGLE = "9000000012"; // one buyer "Alice"; we try addressing "Bob"
const ids: string[] = [];
let pass = true;
const check = (n: string, ok: boolean, extra = "") => { console.log(`${ok ? "  PASS" : "  FAIL"}  ${n}${extra ? ` — ${extra}` : ""}`); if (!ok) pass = false; };

async function main() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("no supabase admin");

  const mk = async (name: string, phone: string, code: string) => {
    const id = randomUUID();
    ids.push(id);
    const { error } = await db.from("buyers").insert({ id, name, phone, login_code: code });
    if (error) throw new Error(`insert ${name}: ${error.message}`);
    return id;
  };

  console.log("Seeding synthetic buyer (Alice on 9000000012)…");
  await mk("Alice Kumar", SINGLE, "CCC3333");

  console.log("\n1) Single buyer resolves cleanly:");
  const r1 = await resolveBuyerByPhone(SINGLE);
  check("resolveBuyerByPhone = ok", r1.status === "ok" && r1.login_code === "CCC3333", `${r1.status}/${r1.login_code}`);

  console.log("\n2) Name mismatch (buyer 'Alice', addressed 'Bob') — MUST withhold code:");
  const a2 = (await resolveAudience({ type: "person", mobile: SINGLE, name: "Bob Singh" }))[0];
  check("addressed name kept as intended (Bob)", (a2?.name || "").startsWith("Bob"), a2?.name || "");
  check("login_code WITHHELD on name mismatch", !a2?.vars?.login_code, `code='${a2?.vars?.login_code ?? ""}'`);

  console.log("\n3) Matching name (buyer 'Alice', addressed 'Alice') — MUST attach code:");
  const a3 = (await resolveAudience({ type: "person", mobile: SINGLE, name: "Alice Kumar" }))[0];
  check("login_code ATTACHED when names agree", a3?.vars?.login_code === "CCC3333", `code='${a3?.vars?.login_code ?? ""}'`);

  console.log("\n4) No intended name (buyer only) — attaches buyer's own code:");
  const a4 = (await resolveAudience({ type: "person", mobile: SINGLE }))[0];
  check("login_code attached when no name to contradict", a4?.vars?.login_code === "CCC3333", `code='${a4?.vars?.login_code ?? ""}'`);

  console.log(`\n${pass ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}`);
}

main()
  .catch((e) => { console.error("ERROR:", e.message); pass = false; })
  .finally(async () => {
    const db = getSupabaseAdmin();
    if (db && ids.length) { await db.from("buyers").delete().in("id", ids); console.log(`Cleaned up ${ids.length} synthetic buyers.`); }
    process.exit(pass ? 0 : 1);
  });
