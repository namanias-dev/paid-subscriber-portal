import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { duplicateWebinar } from "@/lib/dataProvider";
import { istInputToISO } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * FEATURE 2 — Duplicate a webinar. Copies ALL content/media by reference (no R2
 * binaries are duplicated), sets new date/time (IST→UTC)/slug/status, wires
 * lineage between old and new, and (by default) marks the source as ended so it
 * stops accepting payments. Registrants and payment attempts are NOT copied.
 */
export async function POST(req: Request) {
  try {
    if (!(await requirePermission("content_webinars"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sourceId = String(body.sourceId || body.id || "").trim();
    if (!sourceId) return NextResponse.json({ ok: false, error: "Source webinar required." }, { status: 400 });

    // Admin enters IST wall-clock via <input type="datetime-local">.
    const startLocal = String(body.datetime || "").trim();
    const endLocal = String(body.end_datetime || "").trim();
    const datetime = startLocal ? istInputToISO(startLocal) : "";
    if (!datetime) return NextResponse.json({ ok: false, error: "A new date & time is required." }, { status: 400 });

    const actor = await getActionActor();
    const result = await duplicateWebinar(sourceId, {
      datetime,
      end_datetime: endLocal ? istInputToISO(endLocal) : null,
      slug: typeof body.slug === "string" ? body.slug : null,
      status: body.status === "LIVE" ? "LIVE" : "DRAFT",
      copyZoomLink: body.copyZoomLink === true,
      markOldEnded: body.markOldEnded !== false,
      actor: actor?.id ?? null,
    });

    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, webinar: result.webinar });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to duplicate webinar.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
