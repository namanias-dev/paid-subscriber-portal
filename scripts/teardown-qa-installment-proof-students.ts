/**
 * Delete disposable QA installment-proof students and all residue.
 *
 * Usage:
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/teardown-qa-installment-proof-students.ts
 */
import { readFileSync, existsSync } from "fs";
import {
  QA_INSTALLMENT_PROOF_MARKER,
  QA_INSTALLMENT_PROOF_PHONE_LIST,
} from "../lib/qaInstallmentProofStudents";
import { deleteObject } from "../lib/r2";
import { getSupabaseAdmin } from "../lib/supabase";
import { removeOptOut } from "../lib/sms/store";

function loadEnv() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    const v = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  loadEnv();
  const db = getSupabaseAdmin();
  if (!db) throw new Error("no supabase");

  const phones = QA_INSTALLMENT_PROOF_PHONE_LIST;
  const residue: Record<string, number> = {};

  const { data: enrollments } = await db
    .from("course_enrollments")
    .select("id,phone")
    .in("phone", phones);
  const enrollmentIds = (enrollments || []).map((e) => e.id);

  const { data: proofs } = enrollmentIds.length
    ? await db.from("installment_payment_proofs").select("id,files").in("course_enrollment_id", enrollmentIds)
    : { data: [] as { id: string; files: unknown }[] };

  let r2Deleted = 0;
  let r2Failed = 0;
  for (const p of proofs || []) {
    const files = Array.isArray(p.files) ? p.files : [];
    for (const f of files) {
      const key = String((f as { key?: string; path?: string }).key || (f as { path?: string }).path || "");
      if (!key) continue;
      const ok = await deleteObject(key);
      if (ok) r2Deleted += 1;
      else r2Failed += 1;
    }
  }

  if (enrollmentIds.length) {
    await db.from("installment_payment_proofs").delete().in("course_enrollment_id", enrollmentIds);
    await db.from("student_access_events").delete().in("course_enrollment_id", enrollmentIds);
    await db.from("access_reminder_caps").delete().in("course_enrollment_id", enrollmentIds);
  }

  await db.from("course_access_overrides").delete().in("phone", phones);
  await db.from("course_enrollments").delete().in("phone", phones);
  await db.from("students").delete().in("phone", phones);
  await db.from("buyers").delete().in("phone", phones);
  await db.from("grandfather_notice_queue").delete().or(
    phones.map((p) => `phone.eq.${p},phone.eq.91${p},phone.eq.+91${p}`).join(","),
  );

  for (const p of phones) {
    await removeOptOut(p);
  }

  // Strip qa_phones from flag meta
  const { data: flag } = await db
    .from("app_feature_flags")
    .select("meta")
    .eq("key", "installment_proof_popup")
    .maybeSingle();
  if (flag) {
    const meta = { ...((flag.meta as Record<string, unknown>) || {}) };
    const qa = Array.isArray(meta.qa_phones) ? meta.qa_phones.map(String) : [];
    meta.qa_phones = qa.filter((p) => !phones.includes(p.replace(/\D/g, "").slice(-10)));
    if (String(meta.qa_note || "").includes(QA_INSTALLMENT_PROOF_MARKER)) {
      delete meta.qa_note;
    }
    await db
      .from("app_feature_flags")
      .update({ meta, updated_at: new Date().toISOString() })
      .eq("key", "installment_proof_popup");
  }

  // Residue checks
  const tables: Array<{ key: string; table: string; col: string }> = [
    { key: "buyers", table: "buyers", col: "phone" },
    { key: "students", table: "students", col: "phone" },
    { key: "enrollments", table: "course_enrollments", col: "phone" },
    { key: "overrides", table: "course_access_overrides", col: "phone" },
    { key: "opt_outs", table: "sms_opt_outs", col: "normalized_mobile" },
  ];
  for (const t of tables) {
    const { count } = await db.from(t.table).select("*", { count: "exact", head: true }).in(t.col, phones);
    residue[t.key] = count || 0;
  }
  if (enrollmentIds.length) {
    const { count: pr } = await db
      .from("installment_payment_proofs")
      .select("*", { count: "exact", head: true })
      .in("course_enrollment_id", enrollmentIds);
    const { count: ev } = await db
      .from("student_access_events")
      .select("*", { count: "exact", head: true })
      .in("course_enrollment_id", enrollmentIds);
    const { count: caps } = await db
      .from("access_reminder_caps")
      .select("*", { count: "exact", head: true })
      .in("course_enrollment_id", enrollmentIds);
    residue.proofs = pr || 0;
    residue.access_events = ev || 0;
    residue.caps = caps || 0;
  } else {
    residue.proofs = 0;
    residue.access_events = 0;
    residue.caps = 0;
  }

  const { count: queueN } = await db
    .from("grandfather_notice_queue")
    .select("*", { count: "exact", head: true })
    .or(phones.map((p) => `phone.eq.${p},phone.eq.91${p}`).join(","));
  residue.grandfather_queue = queueN || 0;

  const zero = Object.values(residue).every((n) => n === 0) && r2Failed === 0;
  console.log(
    JSON.stringify(
      {
        ok: zero,
        phones,
        enrollmentIdsRemoved: enrollmentIds,
        r2Deleted,
        r2Failed,
        residue,
      },
      null,
      2,
    ),
  );
  if (!zero) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
