/**
 * Stage 1 analysis: who is locked by lectureAccessForCourse today, and who
 * would unlock if zero-amount / null-due lines stop gating.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { lectureAccessForCourse } from "../lib/entitlements";
import { isLineOutstanding, isActiveEnrollment } from "../lib/installments";
import type { CourseEnrollment, Course, InstallmentItem } from "../lib/types";

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

/** Proposed gate: outstanding AND due set AND amount > 0 */
function isAccessGatingLine(i: InstallmentItem): boolean {
  return isLineOutstanding(i) && !!i.due && (Number(i.amount) || 0) > 0;
}

function earliestGating(enrollment: CourseEnrollment, predicate: (i: InstallmentItem) => boolean) {
  const items = (enrollment.schedule || [])
    .filter(predicate)
    .map((i) => ({
      line: i,
      due: Date.parse(i.due as string) || 0,
      amount: Number(i.amount) || 0,
    }))
    .filter((i) => i.due > 0)
    .sort((a, b) => a.due - b.due);
  return items[0] ?? null;
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const now = Date.now();
  const { data: enrs } = await sb
    .from("course_enrollments")
    .select(
      "id,student_name,phone,course_id,course_title,total_fee,amount_paid,status,schedule,plan_type,batch_label,batch_start_at,created_at",
    )
    .neq("status", "cancelled")
    .neq("status", "transferred_out");
  const { data: courses } = await sb.from("courses").select("*");
  const { data: buyers } = await sb.from("buyers").select("phone,login_code");
  const { data: overrides } = await sb.from("course_access_overrides").select("*");
  const login = Object.fromEntries((buyers || []).map((b) => [b.phone, b.login_code]));
  const byCourse = new Map((courses || []).map((c) => [c.id, c as Course]));
  const ovrByKey = new Map<string, (typeof overrides)[0]>();
  for (const o of overrides || []) {
    ovrByKey.set(`${o.phone}|${o.course_id}`, o);
  }

  const blocked: any[] = [];
  const wouldUnlock: any[] = [];
  const zeroAmtBlocked: any[] = [];
  const remainingZeroBlocked: any[] = [];
  let rupeeBefore = 0;
  let rupeeAfter = 0;

  for (const e of (enrs || []) as CourseEnrollment[]) {
    if ((e.amount_paid || 0) <= 0) continue;
    if (!isActiveEnrollment(e)) continue;
    rupeeBefore += e.amount_paid || 0;
    rupeeAfter += e.amount_paid || 0;
    const course = byCourse.get(e.course_id);
    const ovr = ovrByKey.get(`${e.phone}|${e.course_id}`);
    const scheduleAccess = lectureAccessForCourse(course, e, undefined, false, now);
    const liveAccess = lectureAccessForCourse(course, e, ovr as any, false, now);

    const currentGate = earliestGating(e, (i) => isLineOutstanding(i) && !!i.due);
    const fixedGate = earliestGating(e, isAccessGatingLine);

    // Simulate post-fix schedule access: same function but skip zero-amount lines
    // by temporarily marking them paid for the decision only (rows unchanged).
    const simSchedule = (e.schedule || []).map((s) => {
      if (isLineOutstanding(s) && s.due && (Number(s.amount) || 0) <= 0) {
        return { ...s, paid: true, status: "paid" as const };
      }
      // null due outstanding: treat as satisfied for gating (already skipped by earliestUnpaidDue)
      if (isLineOutstanding(s) && !s.due) {
        return { ...s, paid: true, status: "paid" as const };
      }
      return s;
    });
    const simEnr = { ...e, schedule: simSchedule };
    // If marking zero lines paid makes remaining match fully paid, also flip status for sim
    const simPaid = simSchedule.filter((s) => s.paid).reduce((a, s) => a + (s.amount || 0), 0);
    if (simPaid >= (e.total_fee || 0) && e.status !== "fully_paid") {
      (simEnr as any).status = "fully_paid";
    }
    const afterSchedule = lectureAccessForCourse(course, simEnr, undefined, false, now);

    const beforeBlocked = scheduleAccess.status === "blocked" && scheduleAccess.reason === "overdue";
    const afterBlocked = afterSchedule.status === "blocked" && afterSchedule.reason === "overdue";
    const beforeAllowed = scheduleAccess.allowed;
    const afterAllowed = afterSchedule.allowed;

    if (beforeBlocked) {
      const row = {
        name: e.student_name,
        login: login[e.phone] || null,
        id: e.id,
        fee: e.total_fee,
        paid: e.amount_paid,
        pct: e.total_fee ? Math.round((100 * (e.amount_paid || 0)) / e.total_fee) : 0,
        status: e.status,
        rem: Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0)),
        before: `${scheduleAccess.status}/${scheduleAccess.reason}`,
        after: `${afterSchedule.status}/${afterSchedule.reason}`,
        live: `${liveAccess.status}/${liveAccess.reason}`,
        blocking: currentGate
          ? `no=${currentGate.line.no} amt=${currentGate.amount} due=${String(currentGate.line.due).slice(0, 10)} label=${currentGate.line.label}`
          : "none",
        zeroAmt: !!(currentGate && currentGate.amount <= 0),
        unpaidPastDueAmt: (e.schedule || [])
          .filter((s) => isLineOutstanding(s) && s.due && Date.parse(s.due) < now)
          .reduce((a, s) => a + (Number(s.amount) || 0), 0),
      };
      blocked.push(row);
      if (row.zeroAmt) zeroAmtBlocked.push(row);
      if (row.rem <= 0 || row.unpaidPastDueAmt <= 0) remainingZeroBlocked.push(row);
      if (beforeBlocked && !afterBlocked) wouldUnlock.push(row);
    }

    // Tighten check
    if (beforeAllowed && !afterAllowed) {
      console.error("TIGHTEN", e.id, e.student_name, scheduleAccess, afterSchedule);
      process.exit(1);
    }
  }

  console.log(
    JSON.stringify(
      {
        blocked: blocked.length,
        zeroAmtBlocked: zeroAmtBlocked.length,
        remainingZeroBlocked: remainingZeroBlocked.length,
        wouldUnlock: wouldUnlock.length,
        rupeeBefore,
        rupeeAfter,
        rupeeOk: rupeeBefore === rupeeAfter,
      },
      null,
      2,
    ),
  );
  console.log("\n=== ZERO AMT BLOCKED ===");
  for (const r of zeroAmtBlocked) console.log(JSON.stringify(r));
  console.log("\n=== WOULD UNLOCK ===");
  for (const r of wouldUnlock) console.log(JSON.stringify(r));
  console.log("\n=== REMAINING0 / UNPAID_PAST_DUE0 BLOCKED (sample 40) ===");
  for (const r of remainingZeroBlocked.slice(0, 40)) console.log(JSON.stringify(r));

  // Harman
  const harman = (enrs || []).filter(
    (e: any) => e.student_name === "Harman" || login[e.phone] === "YXA32NM",
  );
  console.log("\n=== HARMAN ===");
  for (const h of harman) {
    const course = byCourse.get(h.course_id);
    const a = lectureAccessForCourse(course, h as CourseEnrollment, undefined, false, now);
    console.log(h.student_name, login[h.phone], h.status, h.amount_paid, h.total_fee, a);
    console.log(JSON.stringify(h.schedule));
  }

  writeFileSync(
    "/tmp/stage1-access.json",
    JSON.stringify({ blocked, zeroAmtBlocked, wouldUnlock, remainingZeroBlocked }, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
