/**
 * §1 ARM pilot · §2 Sejalpreet · §3 under-25% call tasks
 */
import { readFileSync, existsSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { armGrandfatherCohort } from "../lib/sms/grandfatherNoticeSend";
import { buildInstallmentReminder } from "../lib/sms/installmentReminderService";
import { firstNamesMatch, resolveBuyersByPhones } from "../lib/sms/store";
import { normalizeIndianMobile } from "../lib/phone";
import { createCollectionsCallTask } from "../lib/accessActions";
import { reconcileDltTemplateFlags } from "../lib/sms/dltReconcile";

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
loadEnv();

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  // --- Template reconcile + loud guard ---
  const rec = await reconcileDltTemplateFlags();
  console.log(JSON.stringify({ section: "1a_reconcile", ...rec }, null, 2));

  // Loud non-approved guard for installment_reminder
  const { data: ir } = await sb
    .from("sms_templates")
    .select("id,status,is_active,gateway_template_id")
    .eq("id", "installment_reminder")
    .maybeSingle();
  const guardOk =
    ir &&
    (ir.status === "approved" || ir.status === "active") &&
    ir.is_active &&
    ir.gateway_template_id === "1777178513223214410";
  console.log(
    JSON.stringify({
      section: "1b_installment_reminder",
      row: ir,
      guardOk,
      seedGateway: "1777178513223214410",
    }),
  );
  if (!guardOk) {
    console.error("STOP: installment_reminder not genuinely sendable — refuse to arm");
    process.exit(2);
  }

  // portal_access_expiring
  const { data: pae } = await sb
    .from("sms_templates")
    .select("id,status,is_active,gateway_template_id")
    .eq("id", "portal_access_expiring")
    .maybeSingle();
  console.log(JSON.stringify({ section: "1c_portal_access_expiring", row: pae }));

  // --- §1 ARM ---
  const n = await armGrandfatherCohort({
    cohort: "pilot_10",
    scheduledForYmd: "2026-08-05",
    scheduleTimeIst: "11:00",
  });
  const { data: pilot } = await sb
    .from("grandfather_notice_queue")
    .select("student_name,armed,scheduled_for_ymd,sent_at,meta")
    .eq("cohort", "pilot_10");
  console.log(
    JSON.stringify(
      {
        section: "1_arm",
        armedCount: n,
        pilot: (pilot || []).map((p) => ({
          name: p.student_name,
          armed: p.armed,
          ymd: p.scheduled_for_ymd,
          sent: !!p.sent_at,
          excluded: !!(p.meta as { excluded_missing_login_code?: boolean })?.excluded_missing_login_code,
        })),
      },
      null,
      2,
    ),
  );

  const { data: pilotRows } = await sb
    .from("grandfather_notice_queue")
    .select("course_enrollment_id,student_name")
    .eq("cohort", "pilot_10")
    .eq("armed", true);
  const sendability = [];
  for (const r of pilotRows || []) {
    const p = await buildInstallmentReminder({ enrollmentId: r.course_enrollment_id });
    sendability.push({
      name: r.student_name,
      sendable: p.sendable,
      block: p.blockReason,
      template: p.templateId,
    });
  }
  console.log(JSON.stringify({ section: "1_sendability", sendability }, null, 2));

  // --- §2 Sejalpreet ---
  const { data: sej } = await sb
    .from("grandfather_notice_queue")
    .select("*")
    .ilike("student_name", "%Sejalpreet%")
    .maybeSingle();
  const phone = sej?.phone || "8146280926";
  const digits = normalizeIndianMobile(phone).digits10!;
  const buyers = await resolveBuyersByPhones([digits]);
  const b = buyers.get(digits);
  const { data: enr } = await sb
    .from("course_enrollments")
    .select("id,student_name,phone,student_id")
    .eq("id", sej?.course_enrollment_id || "d2823995-1d4a-4ce0-878d-87eb9f067320")
    .maybeSingle();
  console.log(
    JSON.stringify({
      section: "2_before",
      enrollmentName: enr?.student_name,
      buyer: b ? { id: b.id, name: b.name, status: b.status, code: b.login_code } : null,
      namesMatch: b ? firstNamesMatch(enr?.student_name || "", b.name) : false,
    }),
  );

  if (b && b.status === "ok" && b.login_code && enr && !firstNamesMatch(enr.student_name, b.name)) {
    const { error } = await sb.from("buyers").update({ name: enr.student_name }).eq("id", b.id);
    console.log(
      JSON.stringify({
        section: "2_fix",
        error: error?.message || null,
        action: "buyer_name_aligned_to_enrollment",
        buyerId: b.id,
        newName: enr.student_name,
      }),
    );
    await sb
      .from("grandfather_notice_queue")
      .update({
        meta: { ...(sej?.meta || {}), excluded_missing_login_code: false, sejalpreet_fixed: true },
        updated_at: new Date().toISOString(),
      })
      .eq("course_enrollment_id", enr.id);
  } else if (enr && (!b || !b.login_code || b.status !== "ok")) {
    // Flag in meta for admin — human decision needed
    await sb
      .from("grandfather_notice_queue")
      .update({
        meta: {
          ...(sej?.meta || {}),
          excluded_missing_login_code: true,
          admin_flag: "sejalpreet_no_login_code",
          admin_flag_reason:
            "Buyer missing or no login_code — cannot auto-fix name match. Needs human identity resolution.",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("course_enrollment_id", enr.id);
    console.log(JSON.stringify({ section: "2_flagged", reason: "no_buyer_or_code" }));
  }

  const buyers2 = await resolveBuyersByPhones([digits]);
  const b2 = buyers2.get(digits);
  const match2 = b2 ? firstNamesMatch(enr?.student_name || "", b2.name) : false;
  const preview2 = enr ? await buildInstallmentReminder({ enrollmentId: enr.id }) : null;
  console.log(
    JSON.stringify({
      section: "2_after",
      match: match2,
      code: b2?.login_code,
      sendable: preview2?.sendable,
      block: preview2?.blockReason,
    }),
  );

  // --- §3 18 call tasks ---
  const dry = JSON.parse(readFileSync("scripts/ladder-dry-run-latest.json", "utf8"));
  const under25 = dry.candidates.filter(
    (c: { bucket: string; proposedChannel: string }) =>
      c.bucket === "under_25_flag" && c.proposedChannel === "call_task",
  );
  console.log(
    JSON.stringify({
      section: "3_plan",
      count: under25.length,
      rupees: under25.reduce((s: number, c: { amountDue: number }) => s + c.amountDue, 0),
    }),
  );
  let created = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const c of under25) {
    const r = await createCollectionsCallTask({
      enrollmentId: c.enrollmentId,
      actor: { id: null, name: "system" },
      reason: "under_25_pct_flag",
      installmentNo: c.installmentNo,
      amountDue: c.amountDue,
      daysOverdue: c.daysOverdue,
    });
    if (r.ok) created++;
    else {
      failed++;
      errors.push(`${c.studentName || c.enrollmentId}: ${r.error}`);
    }
  }
  console.log(JSON.stringify({ section: "3_result", created, failed, errors: errors.slice(0, 10) }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
