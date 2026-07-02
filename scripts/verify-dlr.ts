/**
 * Self-cleaning test for the DLR callback (/api/v1/sms/dlr). Calls the real route
 * handlers directly (no server needed): inserts ONE synthetic SENT log, posts a
 * DELIVERED receipt, asserts it flips SENT->DELIVERED, checks auth rejection, then
 * deletes the row. Also confirms (read-only) that the real test msg-id 3335896 is
 * matchable by the same id-variant logic. Writes only its own synthetic row.
 *   node --env-file=.env.local --import tsx scripts/verify-dlr.ts
 */
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "../lib/supabase";
import { findLogsByMessageIds } from "../lib/sms/store";
import { GET } from "../app/api/v1/sms/dlr/route";

const SITE = "https://namanias.com";
const MSGID = `TESTDLR${Date.now()}`;
const LOGID = randomUUID();
let pass = true;
const check = (n: string, ok: boolean, extra = "") => { console.log(`${ok ? "  PASS" : "  FAIL"}  ${n}${extra ? ` — ${extra}` : ""}`); if (!ok) pass = false; };

async function main() {
  const token = process.env.SMS_DLR_TOKEN || process.env.CRON_SECRET;
  if (!token) throw new Error("No SMS_DLR_TOKEN or CRON_SECRET in env — cannot auth the DLR endpoint.");
  const db = getSupabaseAdmin();
  if (!db) throw new Error("no supabase admin");

  console.log("1) Insert synthetic SENT log…");
  const { error: insErr } = await db.from("sms_logs").insert({
    id: LOGID, mobile: "9000000013", normalized_mobile: "9000000013",
    template_id: "welcome_first_login", template_name: "Welcome / First Login",
    gateway_template_id: "1707178280799637109", sender_id: "NAMIAS", route: "12",
    message_body: "test", character_count: 4, segments: 1, status: "SENT",
    gateway_message_id: MSGID, sent_by_type: "ADMIN", created_at: new Date().toISOString(),
  });
  if (insErr) throw new Error(`insert log: ${insErr.message}`);

  console.log("2) Reject wrong token…");
  const bad = await GET(new Request(`${SITE}/api/v1/sms/dlr?token=WRONG&msgid=${MSGID}&status=DELIVERED`));
  check("wrong token -> 403", bad.status === 403, `http=${bad.status}`);

  console.log("3) Post DELIVERED receipt with correct token…");
  const ok = await GET(new Request(`${SITE}/api/v1/sms/dlr?token=${encodeURIComponent(token)}&msgid=${MSGID}&status=DELIVERED&number=9000000013`));
  const okBody = await ok.json();
  check("accepted + matched + updated", ok.status === 200 && okBody.updated === 1, JSON.stringify(okBody));
  const { data: after } = await db.from("sms_logs").select("status").eq("id", LOGID).single();
  check("log promoted SENT -> DELIVERED", (after as { status?: string } | null)?.status === "DELIVERED", (after as { status?: string } | null)?.status);

  console.log("4) FAILED receipt maps correctly (fresh synthetic)…");
  const id2 = randomUUID();
  await db.from("sms_logs").insert({ id: id2, mobile: "9000000014", normalized_mobile: "9000000014", template_id: "welcome_first_login", template_name: "W", gateway_template_id: "x", sender_id: "NAMIAS", route: "12", message_body: "t", character_count: 1, segments: 1, status: "SENT", gateway_message_id: `${MSGID}B`, sent_by_type: "ADMIN", created_at: new Date().toISOString() });
  const f = await GET(new Request(`${SITE}/api/v1/sms/dlr?token=${encodeURIComponent(token)}&msgid=${MSGID}B&status=UNDELIV`));
  const fBody = await f.json();
  const { data: fAfter } = await db.from("sms_logs").select("status").eq("id", id2).single();
  check("UNDELIV -> FAILED", (fAfter as { status?: string } | null)?.status === "FAILED", `${JSON.stringify(fBody)} status=${(fAfter as { status?: string } | null)?.status}`);
  await db.from("sms_logs").delete().eq("id", id2);

  console.log("5) Real test message 3335896 is matchable by id-variant logic (read-only)…");
  // stored gateway_message_id for the earlier real send was base64 'MzMzNTg5Ng' (=3335896)
  const variants = ["3335896", "MzMzNTg5Ng", "MzMzNTg5Ng=="];
  const found = await findLogsByMessageIds(variants);
  check("finds the real SENT log for 3335896", found.some((l) => l.gateway_message_id === "MzMzNTg5Ng"), `matched=${found.length}`);

  console.log(`\n${pass ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}`);
}

main()
  .catch((e) => { console.error("ERROR:", e.message); pass = false; })
  .finally(async () => {
    const db = getSupabaseAdmin();
    if (db) await db.from("sms_logs").delete().eq("id", LOGID);
    console.log("Cleaned up synthetic DLR log.");
    process.exit(pass ? 0 : 1);
  });
