/**
 * Legacy batch-start backfill + system amnesty grants.
 * Staff grant path (validateAccessGrant without elevated) is unchanged —
 * system amnesty uses elevated:true explicitly here only.
 */
import { getSupabaseAdmin } from "./supabase";
import {
  getAllCourses,
  getAllCourseEnrollments,
  getAllAccessOverrides,
  updateCourse,
  upsertAccessOverride,
  deleteAccessOverride,
} from "./dataProvider";
import { derivedBatchLabelFromStart } from "./batchStart";
import { lectureAccessForCourse } from "./entitlements";
import { isActiveEnrollment, isLineOutstanding } from "./installments";
import { validateAccessGrant } from "./accessOverridePolicy";
import { activeAccessGrant } from "./sms/accessReminderService";
import type { Course, CourseEnrollment, CourseAccessOverride, CourseBatch } from "./types";

export const SAARTHI_OLD_ID = "7c339987-c838-4384-9ee5-5b9fb5ab6630";
export const SAFALTA_OLD_ID = "bfc04537-b84c-4209-83f5-95746a8580dc";
export const TARGET_COURSE_IDS = [SAARTHI_OLD_ID, SAFALTA_OLD_ID] as const;

/** Instructed catalog starts (calendar dates, UTC midnight). */
export const SAFALTA_START_ISO = "2026-06-01T00:00:00.000Z";
/** Deliberately early — do not "correct" toward earliest class. */
export const SAARTHI_START_ISO = "2026-03-01T00:00:00.000Z";

export const AMNESTY_DAYS = 7;
export const AMNESTY_REASON = "Legacy batch start backfill — 7-day amnesty";
export const AMNESTY_ACTOR = "System · amnesty";
export const BACKFILL_ACTOR = "System · legacy backfill";

const DAY_MS = 86_400_000;
const GRACE_DAYS = 15;
const PAID = new Set(["PAID", "captured", "CAPTURED"]);

export type PaymentLite = {
  enrollment_id: string | null;
  phone: string | null;
  status: string;
  transaction_date: string | null;
  created_at: string | null;
  import_source: string | null;
  amount: number | null;
};

/** IST July 2026 window in UTC ms. */
export function july2026IstBounds(): { startMs: number; endMs: number } {
  // 2026-07-01 00:00 IST = 2026-06-30 18:30 UTC
  // 2026-08-01 00:00 IST = 2026-07-31 18:30 UTC
  return {
    startMs: Date.parse("2026-06-30T18:30:00.000Z"),
    endMs: Date.parse("2026-07-31T18:30:00.000Z"),
  };
}

/**
 * True if payment has a real transaction_date inside July 2026 IST.
 * Null-dated legacy rows are NOT counted as July payments (import created_at
 * is not a payment day) — they still count toward amount_paid on the enrolment.
 */
export function isPaidInJuly2026(p: PaymentLite): boolean {
  if (!PAID.has(p.status)) return false;
  if (!p.transaction_date) return false;
  const ms = Date.parse(p.transaction_date);
  if (!Number.isFinite(ms)) return false;
  const { startMs, endMs } = july2026IstBounds();
  return ms >= startMs && ms < endMs;
}

/** Schedule-only access with an injected catalog start (no override). */
export function scheduleAccessWithStart(
  e: CourseEnrollment,
  batchStartISO: string,
  now: number,
): { status: string; reason: string; allowed: boolean } {
  if (e.status === "cancelled" || e.status === "transferred_out" || !isActiveEnrollment(e)) {
    return { status: "blocked", reason: "not_enrolled", allowed: false };
  }
  if (e.status === "fully_paid") {
    return { status: "active", reason: "lifetime", allowed: true };
  }
  const unpaid = (e.schedule || [])
    .filter((i) => isLineOutstanding(i) && i.due)
    .map((i) => ({
      due: Date.parse(i.due as string) || 0,
      grace: i.grace ? Date.parse(i.grace) || null : null,
    }))
    .filter((i) => i.due > 0)
    .sort((a, b) => a.due - b.due)[0];
  if (!unpaid) return { status: "active", reason: "active", allowed: true };

  const batchMs = Date.parse(batchStartISO);
  if (Number.isFinite(batchMs) && now < batchMs) {
    return { status: "active", reason: "pre_batch", allowed: true };
  }
  const graceEnds = unpaid.grace ?? unpaid.due + GRACE_DAYS * DAY_MS;
  if (now <= graceEnds) {
    const overdue = now > unpaid.due;
    return {
      status: overdue ? "grace" : "active",
      reason: overdue ? "grace" : "active",
      allowed: true,
    };
  }
  return { status: "blocked", reason: "overdue", allowed: false };
}

export function startForCourse(courseId: string): string {
  if (courseId === SAARTHI_OLD_ID) return SAARTHI_START_ISO;
  if (courseId === SAFALTA_OLD_ID) return SAFALTA_START_ISO;
  throw new Error(`Not a target course: ${courseId}`);
}

export function needsAmnesty(input: {
  courseId: string;
  scheduleStatus: string;
  paidInJuly: boolean;
}): boolean {
  if (input.scheduleStatus !== "blocked") return false;
  if (input.courseId === SAFALTA_OLD_ID) return true;
  if (input.courseId === SAARTHI_OLD_ID) return !input.paidInJuly;
  return false;
}

export function amnestyExpiresAt(now = Date.now(), days = AMNESTY_DAYS): string {
  return new Date(now + days * DAY_MS).toISOString();
}

/** Patch course batches + course.batch_start; derive labels. Returns before/after. */
export function patchCourseStarts(course: Course, startISO: string): {
  before: Course;
  after: Course;
  batchChanges: { id: string; oldStart: string | null; newStart: string; oldLabel: string | null; newLabel: string }[];
} {
  const before = structuredClone(course);
  const batchChanges: {
    id: string; oldStart: string | null; newStart: string; oldLabel: string | null; newLabel: string;
  }[] = [];
  const batches = (course.batches || []).map((b: CourseBatch) => {
    const mode = Array.isArray(b.mode) ? b.mode[0] : b.mode;
    const timing = Array.isArray(b.timing) ? b.timing[0] : b.timing;
    const newLabel = derivedBatchLabelFromStart(startISO, mode, timing) || b.label || "";
    batchChanges.push({
      id: b.id,
      oldStart: b.start_date ?? null,
      newStart: startISO,
      oldLabel: b.label ?? null,
      newLabel,
    });
    return { ...b, start_date: startISO, label: newLabel };
  });
  const after: Course = { ...course, batches, batch_start: startISO };
  return { before, after, batchChanges };
}

export async function issueSystemAmnestyGrant(input: {
  phone: string;
  courseId: string;
  expiresAt: string;
  now?: number;
}): Promise<{ ok: true; days: number } | { ok: false; error: string }> {
  const check = validateAccessGrant({
    expiresAt: input.expiresAt,
    reason: AMNESTY_REASON,
    elevated: true, // system path only — staff route still uses session elevated
    now: input.now,
  });
  if (!check.ok) return { ok: false, error: check.detail };

  // Do not shorten a longer existing grant (e.g. Aman-style)
  const existing = (await getAllAccessOverrides()).find(
    (o) => o.phone === input.phone && o.course_id === input.courseId && o.mode === "grant",
  );
  if (existing?.expires_at) {
    const existingMs = Date.parse(existing.expires_at);
    const nextMs = Date.parse(input.expiresAt);
    if (Number.isFinite(existingMs) && existingMs > nextMs) {
      return { ok: true, days: check.days }; // keep longer grant; treat as ok skip
    }
  }

  await upsertAccessOverride({
    phone: input.phone,
    course_id: input.courseId,
    mode: "grant",
    expires_at: input.expiresAt,
    note: AMNESTY_REASON,
    created_by: AMNESTY_ACTOR,
  });

  const db = getSupabaseAdmin();
  if (db) {
    await db.from("access_override_events").insert({
      phone: input.phone,
      course_id: input.courseId,
      actor: AMNESTY_ACTOR,
      kind: "granted",
      detail: `Access granted for ${check.days} day(s) until ${input.expiresAt.slice(0, 10)}`,
      reason: AMNESTY_REASON,
      meta: { days: check.days, expires_at: input.expiresAt, system: true, legacy_backfill: true },
    }).then(() => undefined, () => undefined);
  }
  return { ok: true, days: check.days };
}

export async function writeBatchTimelineEvents(
  courseId: string,
  title: string,
  changes: { id: string; oldStart: string | null; newStart: string; oldLabel: string | null; newLabel: string }[],
): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  // One event per batch on a synthetic phone key for audit (surfaced in ops, not student SMS).
  for (const c of changes) {
    await db.from("access_override_events").insert({
      phone: `batch:${c.id}`,
      course_id: courseId,
      actor: BACKFILL_ACTOR,
      kind: "granted",
      detail: `${title} · batch ${c.id}: start ${c.oldStart || "null"} → ${c.newStart}; label "${c.oldLabel || ""}" → "${c.newLabel}"`,
      reason: "Legacy batch start backfill",
      meta: { ...c, course_title: title, system: true, legacy_backfill: true },
    }).then(() => undefined, () => undefined);
  }
}

export async function saveBackfillSnapshot(input: {
  tag: string;
  coursesBefore: unknown;
  grantsIssued: unknown;
  settingsBefore: unknown;
  notes?: string;
}): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data, error } = await db.from("legacy_batch_start_backfill_snapshots").insert({
    tag: input.tag,
    courses_before: input.coursesBefore,
    grants_issued: input.grantsIssued,
    settings_before: input.settingsBefore,
    actor: BACKFILL_ACTOR,
    notes: input.notes ?? null,
  }).select("id").single();
  if (error) {
    console.error("snapshot insert failed", error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function revertBackfillSnapshot(snapshotId: string): Promise<{ ok: boolean; detail: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, detail: "no db" };
  const { data: snap } = await db.from("legacy_batch_start_backfill_snapshots")
    .select("*").eq("id", snapshotId).maybeSingle();
  if (!snap) return { ok: false, detail: "snapshot not found" };
  if (snap.reverted_at) return { ok: false, detail: "already reverted" };

  const coursesBefore = snap.courses_before as Course[];
  for (const c of coursesBefore) {
    await updateCourse(c.id, { batches: c.batches, batch_start: c.batch_start });
  }
  const grants = (snap.grants_issued || []) as { phone: string; course_id: string }[];
  for (const g of grants) {
    await deleteAccessOverride(g.phone, g.course_id);
  }
  await db.from("legacy_batch_start_backfill_snapshots")
    .update({ reverted_at: new Date().toISOString() })
    .eq("id", snapshotId);
  return { ok: true, detail: `Reverted courses=${coursesBefore.length} grants=${grants.length}` };
}

/** Live portal blocked for overdue (override considered). */
export function isLiveOverdueBlocked(
  course: Course | undefined,
  e: CourseEnrollment,
  override: CourseAccessOverride | null | undefined,
  now: number,
): boolean {
  const live = lectureAccessForCourse(course, e, override ?? undefined, false, now);
  return !live.allowed && live.reason === "overdue";
}

export function phoneHasJulyPayment(
  phone: string,
  enrollmentId: string,
  payments: PaymentLite[],
): { paidInJuly: boolean; nullDatedLegacy: number; julyCount: number } {
  const mine = payments.filter(
    (p) => p.enrollment_id === enrollmentId || p.phone === phone,
  );
  const nullDatedLegacy = mine.filter(
    (p) => PAID.has(p.status) && !p.transaction_date && p.import_source === "saarthi_legacy",
  ).length;
  const july = mine.filter(isPaidInJuly2026);
  return { paidInJuly: july.length > 0, nullDatedLegacy, julyCount: july.length };
}

export async function applyCourseStartDates(): Promise<{
  patched: { courseId: string; title: string; start: string; batchChanges: ReturnType<typeof patchCourseStarts>["batchChanges"] }[];
  coursesBefore: Course[];
}> {
  const courses = await getAllCourses();
  const coursesBefore: Course[] = [];
  const patched: {
    courseId: string; title: string; start: string;
    batchChanges: ReturnType<typeof patchCourseStarts>["batchChanges"];
  }[] = [];

  for (const id of TARGET_COURSE_IDS) {
    const course = courses.find((c) => c.id === id);
    if (!course) throw new Error(`Course missing: ${id}`);
    const start = startForCourse(id);
    const { before, after, batchChanges } = patchCourseStarts(course, start);
    coursesBefore.push(before);
    await updateCourse(id, { batches: after.batches, batch_start: after.batch_start });
    await writeBatchTimelineEvents(id, course.title, batchChanges);
    patched.push({ courseId: id, title: course.title, start, batchChanges });
  }
  return { patched, coursesBefore };
}

export async function planAmnestyCohort(input: {
  payments: PaymentLite[];
  now?: number;
}): Promise<{
  candidates: {
    enrollmentId: string;
    phone: string;
    name: string;
    courseId: string;
    courseTitle: string;
    paidInJuly: boolean;
    nullDatedLegacy: number;
    scheduleStatus: string;
    owed: number;
  }[];
  saarthiSplit: { paidJuly: number; noJuly: number; paidJulyOwed: number; noJulyOwed: number };
}> {
  const now = input.now ?? Date.now();
  const [enrollments, courses] = await Promise.all([
    getAllCourseEnrollments(),
    getAllCourses(),
  ]);
  const byId = new Map(courses.map((c) => [c.id, c]));
  const candidates: {
    enrollmentId: string; phone: string; name: string; courseId: string; courseTitle: string;
    paidInJuly: boolean; nullDatedLegacy: number; scheduleStatus: string; owed: number;
  }[] = [];

  let paidJuly = 0, noJuly = 0, paidJulyOwed = 0, noJulyOwed = 0;

  for (const e of enrollments) {
    if (!TARGET_COURSE_IDS.includes(e.course_id as typeof TARGET_COURSE_IDS[number])) continue;
    if (e.status === "cancelled" || e.status === "transferred_out" || !isActiveEnrollment(e)) continue;
    const start = startForCourse(e.course_id);
    const access = scheduleAccessWithStart(e, start, now);
    const pay = phoneHasJulyPayment(e.phone, e.id, input.payments);
    const owed = Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0));

    if (e.course_id === SAARTHI_OLD_ID) {
      if (pay.paidInJuly) { paidJuly++; paidJulyOwed += owed; }
      else { noJuly++; noJulyOwed += owed; }
    }

    if (!needsAmnesty({
      courseId: e.course_id,
      scheduleStatus: access.status,
      paidInJuly: pay.paidInJuly,
    })) continue;

    candidates.push({
      enrollmentId: e.id,
      phone: e.phone,
      name: e.student_name || "?",
      courseId: e.course_id,
      courseTitle: e.course_title || byId.get(e.course_id)?.title || "",
      paidInJuly: pay.paidInJuly,
      nullDatedLegacy: pay.nullDatedLegacy,
      scheduleStatus: access.status,
      owed,
    });
  }

  return {
    candidates,
    saarthiSplit: { paidJuly, noJuly, paidJulyOwed, noJulyOwed },
  };
}
