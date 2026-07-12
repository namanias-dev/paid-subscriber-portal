import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { logWebinarAudit } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

function norm(p: unknown): string {
  return String(p ?? "").replace(/\D/g, "").slice(-10);
}

/**
 * Post-webinar attendance capture (ADDITIVE, read-only on finance).
 *
 * POST /api/admin/webinars/:id/attendance  { phones: string[], apply?: boolean }
 *  - apply !== true  → DRY RUN: how many EXISTING rows would flip attended=true.
 *  - apply === true  → sets attended=true on matching EXISTING registration rows.
 *
 * Guarantees: matches ONLY existing rows by normalized last-10 phone, NEVER creates
 * rows, NEVER touches payments/enrollments. Super-Admin / content_webinars gated.
 * This is the going-forward path to populate webinar_registrations.attended (e.g. from
 * a Zoom/GMeet attendee export) so attendee-vs-no-show conversion becomes real.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("content_webinars"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const webinarId = String(params.id || "").trim();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const rawPhones = Array.isArray(body.phones) ? body.phones : [];
    const phones = Array.from(new Set(rawPhones.map((p) => norm(p)).filter((p) => p.length === 10)));
    const apply = body.apply === true;
    if (!webinarId || phones.length === 0) {
      return NextResponse.json({ ok: false, error: "webinar id and a non-empty phones[] are required." }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Database unavailable." }, { status: 503 });

    const { data: rows, error } = await db
      .from("webinar_registrations")
      .select("id, phone, attended")
      .eq("webinar_id", webinarId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const wanted = new Set(phones);
    const registered = rows || [];
    const toMark = registered.filter((r) => wanted.has(norm(r.phone)) && !r.attended);
    const alreadyMarked = registered.filter((r) => wanted.has(norm(r.phone)) && r.attended).length;
    const matchedPhones = new Set(registered.map((r) => norm(r.phone)).filter((p) => wanted.has(p)));
    const unmatched = phones.filter((p) => !matchedPhones.has(p)).length;

    if (!apply) {
      return NextResponse.json({
        ok: true,
        mode: "dry-run",
        webinar_id: webinarId,
        wouldMark: toMark.length,
        alreadyMarked,
        unmatchedPhones: unmatched,
      });
    }

    const ids = toMark.map((r) => r.id);
    if (ids.length) {
      const { error: uerr } = await db.from("webinar_registrations").update({ attended: true }).in("id", ids);
      if (uerr) return NextResponse.json({ ok: false, error: uerr.message }, { status: 500 });
    }
    const actor = await getActionActor();
    await logWebinarAudit({
      action: "attendance_marked",
      webinar_id: webinarId,
      actor: actor?.id ?? "system",
      count: ids.length,
      detail: { unmatched, alreadyMarked },
    }).catch(() => {});

    return NextResponse.json({ ok: true, mode: "apply", webinar_id: webinarId, marked: ids.length, unmatchedPhones: unmatched });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to mark attendance.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
