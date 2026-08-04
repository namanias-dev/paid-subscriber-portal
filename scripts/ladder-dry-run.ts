/**
 * Stage 2c segmented dry-run for instalment ladder backlog.
 * SENDS NOTHING. Writes /tmp/ladder-dry-run.json + prints summary.
 *
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/ladder-dry-run.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { getAllCourseEnrollments, getAllCourses } from "../lib/dataProvider";
import { isActiveEnrollment } from "../lib/installments";
import { lectureAccessForCourse } from "../lib/entitlements";
import { isScheduleCollectionsRisk, nextUnpaidDatedLine } from "../lib/accessAtRisk";
import { evaluateEnrollmentForBackfill, type LadderDryCandidate } from "../lib/sms/installmentLadder";
import { resolveEnrollmentBatchStart } from "../lib/batchStart";
import { listLogs } from "../lib/sms/store";
import type { CourseEnrollment } from "../lib/types";

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

const REVIEW_RE = /\b(refund|complaint|dispute|arrangement|promise to pay|hold access|do not (sms|message|call)|settlement|waive)\b/i;

async function main() {
  loadEnv();
  const now = Date.now();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const [enrollments, courses, buyers] = await Promise.all([
    getAllCourseEnrollments(),
    getAllCourses(),
    sb.from("buyers").select("phone,login_code").then((r) => r.data || []),
  ]);
  const byCourse = new Map(courses.map((c) => [c.id, c]));
  const login = Object.fromEntries(buyers.map((b) => [b.phone, b.login_code]));

  // Last SMS contact (any template) per enrollment / phone
  const since = new Date(now - 365 * 86400000).toISOString();
  const logs = await listLogs({ from: since, limit: 20000 });
  const lastByEnrollment = new Map<string, string>();
  const lastByPhone = new Map<string, string>();
  for (const l of logs) {
    if (!["SENT", "DELIVERED", "QUEUED"].includes(l.status)) continue;
    const at = l.sent_at || l.created_at;
    if (l.course_enrollment_id) {
      const prev = lastByEnrollment.get(l.course_enrollment_id);
      if (!prev || prev < at) lastByEnrollment.set(l.course_enrollment_id, at);
    }
    if (l.normalized_mobile) {
      const prev = lastByPhone.get(l.normalized_mobile);
      if (!prev || prev < at) lastByPhone.set(l.normalized_mobile, at);
    }
  }

  // Soft signals for human review (timeline table may not exist on all envs)
  let notes: { phone?: string; enrollment_id?: string; summary?: string; detail?: unknown }[] = [];
  try {
    const r = await sb
      .from("student_timeline_events")
      .select("phone,enrollment_id,summary,detail,created_at")
      .gte("created_at", since)
      .limit(5000);
    notes = r.data || [];
  } catch {
    notes = [];
  }

  const excludeByEnrollment = new Map<string, string>();
  for (const n of notes || []) {
    const blob = `${n.summary || ""} ${typeof n.detail === "string" ? n.detail : JSON.stringify(n.detail || {})}`;
    if (!REVIEW_RE.test(blob)) continue;
    const id = n.enrollment_id as string | null;
    if (id) excludeByEnrollment.set(id, `timeline: ${blob.slice(0, 120)}`);
  }

  // Also scan enrollment notes / payment gateway_ref notes if present
  for (const e of enrollments) {
    for (const s of e.schedule || []) {
      const blob = `${s.notes || ""} ${s.cancelled_reason || ""} ${s.label || ""}`;
      if (REVIEW_RE.test(blob)) {
        excludeByEnrollment.set(e.id, `schedule note: ${blob.slice(0, 120)}`);
      }
    }
  }

  let blocked = 0;
  let grace = 0;
  let moneyOverdue = 0;
  let failSafeAccessOnly = 0;
  const candidates: LadderDryCandidate[] = [];

  for (const e of enrollments) {
    if (!isActiveEnrollment(e) || (e.amount_paid || 0) <= 0) continue;
    if (e.status === "cancelled" || e.status === "transferred_out") continue;
    const course = byCourse.get(e.course_id);
    const access = lectureAccessForCourse(course, e, undefined, false, now);
    if (access.status === "blocked" && access.reason === "overdue") blocked++;
    if (access.status === "grace") grace++;
    const line = nextUnpaidDatedLine(e.schedule);
    if (line?.due && Date.parse(line.due) < now) moneyOverdue++;
    const batch = resolveEnrollmentBatchStart(course, e);
    if (line?.due && Date.parse(line.due) < now && access.allowed && !batch.iso) failSafeAccessOnly++;

    if (!line?.due || Date.parse(line.due) >= now) continue;

    const last =
      lastByEnrollment.get(e.id) ||
      lastByPhone.get((e.phone || "").replace(/\D/g, "").slice(-10)) ||
      null;

    const row = evaluateEnrollmentForBackfill({
      enrollment: e as CourseEnrollment,
      course,
      loginCode: login[e.phone] || null,
      lastContactAt: last,
      excludeReason: excludeByEnrollment.get(e.id) || null,
      now,
    });
    if (row) candidates.push(row);
  }

  const buckets: Record<string, LadderDryCandidate[]> = {};
  for (const c of candidates) {
    (buckets[c.bucket] ||= []).push(c);
  }

  const smsWould = candidates.filter((c) => c.proposedChannel === "sms");
  const callWould = candidates.filter((c) => c.proposedChannel === "call_task");
  const none = candidates.filter((c) => c.proposedChannel === "none");

  const report = {
    generatedAt: new Date(now).toISOString(),
    sent: 0,
    liveCounts: {
      genuinelyBlocked: blocked,
      genuinelyGrace: grace,
      moneyOverdueAligned: moneyOverdue,
      accessOnlyViaUnknownBatchFailSafe: failSafeAccessOnly,
    },
    bucketCounts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
    wouldSms: smsWould.length,
    wouldCallTask: callWould.length,
    wouldSkip: none.length,
    candidates,
  };

  writeFileSync("/tmp/ladder-dry-run.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ...report,
    candidates: undefined,
    sampleSms: smsWould.slice(0, 5),
    sampleCall: callWould.slice(0, 5),
    sampleExclude: (buckets.exclude_review || []).slice(0, 10),
    sampleSkip: (buckets.skip_not_live_risk || []).slice(0, 5),
  }, null, 2));
  console.log("\nWrote /tmp/ladder-dry-run.json — SEND NOTHING.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
