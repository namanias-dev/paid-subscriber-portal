/**
 * One-time FULL historical match report (read-only). Sends nothing, writes nothing.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/_react-cache-shim.mjs \
 *     scripts/qa/legacy-lead-match-report.ts
 */
import { getSupabaseAdmin } from "../../lib/supabase";

async function main() {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("No supabase admin");
  const db = admin;
  const t0 = Date.now();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = async (table: string, filter?: (q: any) => any) => {
    let q = db.from(table).select("id", { count: "exact", head: true });
    if (filter) q = filter(q);
    const { count: c, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    return c || 0;
  };

  const totals = {
    legacy_leads: await count("leads", (q) => q.eq("is_legacy", true).is("merged_into", null)),
    live_leads: await count("leads", (q) => q.eq("is_legacy", false).is("merged_into", null)),
    students: await count("students"),
    payments: await count("payments", (q) => q.is("deleted_at", null)),
    enrollments: await count("course_enrollments"),
    webinar_regs: await count("webinar_registrations"),
  };
  console.log("\n=== TOTALS ===");
  console.table([totals]);

  async function allPhoneKeys(table: string, legacyOnly?: boolean): Promise<string[]> {
    const keys: string[] = [];
    let from = 0;
    const page = 1000;
    for (;;) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = db.from(table).select("phone_key").range(from, from + page - 1);
      if (table === "leads") {
        q = legacyOnly
          ? q.eq("is_legacy", true).is("merged_into", null)
          : q.eq("is_legacy", false).is("merged_into", null);
      }
      if (table === "payments") q = q.is("deleted_at", null);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = data || [];
      for (const r of rows) {
        const k = (r as { phone_key?: string }).phone_key;
        if (k && k.length === 10 && /^[6-9]/.test(k)) keys.push(k);
      }
      if (rows.length < page) break;
      from += page;
    }
    return keys;
  }

  console.log("Loading phone keys…");
  const [legacyKeys, liveKeys, studentKeys, paymentKeys, enrollKeys] = await Promise.all([
    allPhoneKeys("leads", true),
    allPhoneKeys("leads", false),
    allPhoneKeys("students"),
    allPhoneKeys("payments"),
    allPhoneKeys("course_enrollments"),
  ]);

  const legacySet = new Set(legacyKeys);
  const matchRate = (keys: string[]) => {
    const uniq = [...new Set(keys)];
    const matched = uniq.filter((k) => legacySet.has(k)).length;
    return {
      uniq: uniq.length,
      matched,
      rate: uniq.length ? ((matched / uniq.length) * 100).toFixed(1) + "%" : "n/a",
    };
  };

  console.log("\n=== MATCH RATES (unique phone_key) ===");
  console.table([
    { table: "live_leads", ...matchRate(liveKeys) },
    { table: "students", ...matchRate(studentKeys) },
    { table: "payments", ...matchRate(paymentKeys) },
    { table: "course_enrollments", ...matchRate(enrollKeys) },
  ]);

  console.log("\n=== LEGACY KEY VALIDITY ===");
  console.table([{
    legacy_rows: totals.legacy_leads,
    phone_keys_loaded: legacyKeys.length,
    unique_legacy_phones: new Set(legacyKeys).size,
    unmatchable: totals.legacy_leads - legacyKeys.length,
  }]);

  const multi = new Map<string, number>();
  for (const k of legacyKeys) multi.set(k, (multi.get(k) || 0) + 1);
  let multiPhones = 0;
  let maxMulti = 0;
  for (const n of multi.values()) {
    if (n > 1) {
      multiPhones++;
      maxMulti = Math.max(maxMulti, n);
    }
  }
  console.log("\n=== MULTI LEGACY ROWS PER PHONE ===");
  console.table([{ phones_with_multiple: multiPhones, max_rows_one_phone: maxMulti }]);

  console.log(`\nRuntime: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
