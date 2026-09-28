import { NextResponse } from "next/server";
import { getBuyerSession, getStudentSession } from "@/lib/session";
import { getStudentById, rateLimited } from "@/lib/dataProvider";
import { getSupabaseAdmin } from "@/lib/supabase";
import { recordPortalActivity } from "@/lib/analytics/portalActivity";

export const dynamic = "force-dynamic";

/**
 * Records that a signed-in student used the portal or dashboard today.
 * Anonymous callers are ignored. Staff test buyers are ignored.
 * Does not touch login, sessions, or payments.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { surface?: string };
    const surface = body.surface === "dashboard" ? "dashboard" : "portal";

    const [buyer, student] = await Promise.all([
      getBuyerSession().catch(() => null),
      getStudentSession().catch(() => null),
    ]);
    if (!buyer && !student) {
      return NextResponse.json({ ok: true, skipped: "anon" });
    }

    if (buyer) {
      const limited = await rateLimited(`portal-active:${buyer.buyer_id}`, 6, 3600).catch(() => false);
      if (limited) return NextResponse.json({ ok: true, skipped: "rate" });
      const db = getSupabaseAdmin();
      if (db) {
        const { data } = await db.from("buyers").select("is_staff").eq("id", buyer.buyer_id).maybeSingle();
        if (data && (data as { is_staff?: boolean }).is_staff) {
          return NextResponse.json({ ok: true, skipped: "staff" });
        }
      }
      await recordPortalActivity({
        buyerId: buyer.buyer_id,
        phone: buyer.phone,
        studentId: student?.student_id || null,
        surface,
      });
      return NextResponse.json({ ok: true, recorded: true });
    }

    const studentId = student!.student_id;
    const limited = await rateLimited(`portal-active:s:${studentId}`, 6, 3600).catch(() => false);
    if (limited) return NextResponse.json({ ok: true, skipped: "rate" });
    const row = await getStudentById(studentId).catch(() => null);
    await recordPortalActivity({
      studentId,
      phone: row?.phone || null,
      surface: "dashboard",
    });
    return NextResponse.json({ ok: true, recorded: true });
  } catch {
    return NextResponse.json({ ok: true, skipped: "error" });
  }
}
