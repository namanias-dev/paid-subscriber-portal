import { NextResponse } from "next/server";
import { requirePermission, currentAdminId } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getCourseEnrollmentById, getAllCourses } from "@/lib/dataProvider";
import { planTransfer, transferIsPermitted } from "@/lib/enrollmentTransfer";
import { buildBatchLabel, batchTimings } from "@/lib/installments";
import type { Course } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Batch / course transfer — preview (POST) and commit (PUT).
 *
 * PERMISSIONS ARE ENFORCED HERE, not in the UI. A transfer moves money and
 * changes what a student can access, so it needs both the payments and the
 * students permission; pushing past a full batch additionally needs super_admin.
 *
 * THE PREVIEW AND THE COMMIT COMPUTE THE SAME PLAN FROM THE SAME FUNCTION. The
 * client cannot hand us a schedule or a fee — it names a target and a reason, and
 * the server derives everything else. That is what makes "what the admin approved
 * is what got written" true rather than hopeful.
 */
async function loadContext(enrollmentId: string, targetCourseId: string | null) {
  const [enrollment, courses] = await Promise.all([getCourseEnrollmentById(enrollmentId), getAllCourses()]);
  if (!enrollment) return { error: "That enrollment does not exist." as const };
  const sourceCourse = courses.find((c) => c.id === enrollment.course_id) ?? null;
  const targetCourse = targetCourseId ? courses.find((c) => c.id === targetCourseId) ?? null : sourceCourse;
  return { enrollment, courses, sourceCourse, targetCourse };
}

/** The batches a transfer may target, with everything the picker needs to be honest. */
function batchOptions(course: Course) {
  return (course.batches ?? []).map((b) => ({
    id: b.id,
    label: b.label,
    /** The generated label form, which is what gets written to the enrollment. */
    resolvedLabel: buildBatchLabel(b.start_date ?? null, batchTimings(b)) ?? b.label,
    startDate: b.start_date ?? null,
    price: b.price,
    payInFullPrice: b.pay_in_full_price ?? null,
    capacity: b.capacity ?? null,
    seatsLeft: b.seats_left ?? null,
  }));
}

export async function POST(req: Request) {
  if (!(await requirePermission("manage_students_leads")) || !(await requirePermission("manage_payments"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const enrollmentId = typeof body.enrollmentId === "string" ? body.enrollmentId : "";
  const targetCourseId = typeof body.targetCourseId === "string" ? body.targetCourseId : null;
  const targetBatchId = typeof body.targetBatchId === "string" ? body.targetBatchId : null;
  if (!enrollmentId) return NextResponse.json({ ok: false, error: "enrollmentId is required." }, { status: 400 });

  const ctx = await loadContext(enrollmentId, targetCourseId);
  if ("error" in ctx) return NextResponse.json({ ok: false, error: ctx.error }, { status: 404 });
  const { enrollment, courses, sourceCourse, targetCourse } = ctx;

  // Step 1 + step 2 data: the current state, and what may be chosen.
  const shell = {
    ok: true as const,
    current: {
      enrollmentId: enrollment.id,
      studentName: enrollment.student_name,
      courseId: enrollment.course_id,
      courseTitle: enrollment.course_title,
      batchId: enrollment.batch_id ?? null,
      batchLabel: enrollment.batch_label ?? null,
      status: enrollment.status,
      planType: enrollment.plan_type,
      totalFee: enrollment.total_fee,
      amountPaid: enrollment.amount_paid,
      outstanding: Math.max(0, (enrollment.total_fee || 0) - (enrollment.amount_paid || 0)),
      schedule: enrollment.schedule ?? [],
      createdAt: enrollment.created_at,
    },
    courses: courses
      .filter((c) => (c.batches ?? []).length)
      .map((c) => ({ id: c.id, title: c.title, slug: c.slug, batches: batchOptions(c) })),
    sourceBatches: sourceCourse ? batchOptions(sourceCourse) : [],
  };

  // Step 3 only exists once a target batch is named.
  if (!targetBatchId || !targetCourse) return NextResponse.json({ ...shell, plan: null });

  const plan = planTransfer({ enrollment, sourceCourse, targetCourse, targetBatchId });
  return NextResponse.json({ ...shell, plan, canCommit: transferIsPermitted(plan, { overrideCapacity: false }) });
}

export async function PUT(req: Request) {
  if (!(await requirePermission("manage_students_leads")) || !(await requirePermission("manage_payments"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const enrollmentId = typeof body.enrollmentId === "string" ? body.enrollmentId : "";
  const targetCourseId = typeof body.targetCourseId === "string" ? body.targetCourseId : null;
  const targetBatchId = typeof body.targetBatchId === "string" ? body.targetBatchId : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const overrideCapacity = body.overrideCapacity === true;

  if (!enrollmentId || !targetBatchId) {
    return NextResponse.json({ ok: false, error: "enrollmentId and targetBatchId are required." }, { status: 400 });
  }
  if (reason.length < 5) {
    return NextResponse.json({ ok: false, error: "A reason is required, and it has to say something." }, { status: 400 });
  }
  // `super_admin` is a role rather than a permission, so the override is gated on
  // manage_roles — the permission only the top role carries.
  if (overrideCapacity && !(await requirePermission("manage_roles"))) {
    return NextResponse.json({ ok: false, error: "Overriding a full batch requires a senior admin." }, { status: 403 });
  }

  const ctx = await loadContext(enrollmentId, targetCourseId);
  if ("error" in ctx) return NextResponse.json({ ok: false, error: ctx.error }, { status: 404 });
  const { enrollment, sourceCourse, targetCourse } = ctx;
  if (!targetCourse) return NextResponse.json({ ok: false, error: "That target course does not exist." }, { status: 404 });

  // Recomputed here rather than trusted from the client: the figures written are
  // derived server-side from current data, so a stale or edited preview cannot
  // become a wrong schedule.
  const plan = planTransfer({ enrollment, sourceCourse, targetCourse, targetBatchId, overrideCapacity });
  if (!transferIsPermitted(plan, { overrideCapacity })) {
    return NextResponse.json({ ok: false, error: "This transfer is blocked.", blocks: plan.blocks }, { status: 409 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Database not configured." }, { status: 500 });

  const { data, error } = await db.rpc("transfer_enrollment", {
    p_enrollment_id: enrollmentId,
    p_to_course_id: targetCourse.id,
    p_to_course_slug: targetCourse.slug,
    p_to_course_title: targetCourse.title,
    p_to_batch_id: targetBatchId,
    p_to_batch_label: plan.target.batchLabel,
    p_new_total_fee: plan.money.newTotal,
    p_new_schedule: plan.schedule.after,
    p_shift_days: plan.schedule.shiftDays,
    p_reason: reason,
    p_actor_user_id: await currentAdminId(),
    p_capacity_overridden: overrideCapacity,
    // The guard against the money moving while a human was reading the preview.
    p_expected_amount_paid: enrollment.amount_paid ?? 0,
  });

  if (error) {
    // The function raises rather than half-writing, so a failure here means
    // nothing at all changed.
    return NextResponse.json({ ok: false, error: error.message, rolledBack: true }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    newEnrollmentId: data,
    from: { courseTitle: plan.source.courseTitle, batchLabel: plan.source.batchLabel },
    to: { courseTitle: plan.target.courseTitle, batchLabel: plan.target.batchLabel },
    money: plan.money,
    shiftDays: plan.schedule.shiftDays,
    capacityOverridden: overrideCapacity,
  });
}
