import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getStudentById } from "@/lib/dataProvider";
import {
  transferEvent, paymentEvent, smsEvent, enrollmentEvents, sortTimeline,
  type TimelineEvent, type TimelineEventType,
} from "@/lib/studentTimeline";

export const dynamic = "force-dynamic";

/**
 * The student's event history.
 *
 * Every source is queried by an indexed key (phone, or enrollment id) and the
 * merge happens once over the combined set — no per-row lookups, which is what
 * would turn a profile page into N+1 queries as a student accumulates events.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requirePermission("manage_students_leads"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  const typeFilter = (url.searchParams.get("types") ?? "").split(",").filter(Boolean) as TimelineEventType[];

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Database not configured." }, { status: 500 });

  const student = await getStudentById(id);
  if (!student) return NextResponse.json({ ok: false, error: "No such student." }, { status: 404 });
  const phone = student.phone;

  const started = Date.now();
  const [transfers, enrollments, payments, sms] = await Promise.all([
    db.from("enrollment_transfers").select("*").eq("student_phone", phone).order("created_at", { ascending: false }),
    db.from("course_enrollments")
      .select("id, created_at, course_title, batch_label, total_fee, plan_type, status, payment_plan_changed_at, payment_plan_changed_by, payment_plan_change_reason, discount_amount, discount_applied_at, discount_applied_by, discount_reason, original_total_fee")
      .eq("phone", phone),
    db.from("payments")
      .select("id, created_at, amount, status, item, payment_kind, installment_no, mode, reference_no, receipt_no")
      .eq("phone", phone).eq("status", "PAID").order("created_at", { ascending: false }).limit(200),
    db.from("sms_logs")
      .select("id, created_at, sent_at, template_name, status, sent_by_type, installment_no, course_id")
      .eq("normalized_mobile", normalize(phone)).order("created_at", { ascending: false }).limit(200),
  ]);

  const events: TimelineEvent[] = [
    ...(transfers.data ?? []).map((r) => transferEvent(r as never)),
    ...(enrollments.data ?? []).flatMap((e) => enrollmentEvents(e as never)),
    ...(payments.data ?? []).map((p) => paymentEvent(p as never)),
    ...(sms.data ?? []).map((s) => smsEvent(s as never)),
  ];

  const sorted = sortTimeline(events);
  const filtered = typeFilter.length ? sorted.filter((e) => typeFilter.includes(e.type)) : sorted;
  const queryMs = Date.now() - started;

  return NextResponse.json({
    ok: true,
    total: filtered.length,
    queryMs,
    counts: countByType(sorted),
    events: filtered.slice(offset, offset + limit),
  });
}

function normalize(phone: string): string {
  return (phone || "").replace(/\D/g, "").slice(-10);
}

function countByType(events: TimelineEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
}
