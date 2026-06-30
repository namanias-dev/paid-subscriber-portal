import { NextResponse } from "next/server";
import { getWebinarById } from "@/lib/dataProvider";
import { getBuyerSession } from "@/lib/session";
import { phoneHasAccessToItem } from "@/lib/paymentProofs";
import { requireAnyPermission } from "@/lib/adminGuard";
import { r2Configured, signGetUrl, PLAYBACK_TTL } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Mint a short-lived signed playback URL for a hosted WEBINAR recording — ONLY
 * after re-checking access on the server for THIS request (never trust the
 * client). Access = an admin with content permission, OR a buyer who PAID for
 * THIS exact webinar (per-event; a paid sibling re-run does NOT unlock it). The
 * R2 key is never returned; bytes stream R2→browser via the signed URL.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const webinar = await getWebinarById(params.id);
  if (!webinar || webinar.recording_upload_status !== "completed" || !webinar.recording_key) {
    return NextResponse.json({ ok: false, error: "Recording not available" }, { status: 404 });
  }
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "Playback not configured" }, { status: 503 });

  // Access re-check: admin OR a paying attendee of this exact webinar.
  let allowed = await requireAnyPermission(["content_courses", "content_webinars"]);
  if (!allowed) {
    const session = await getBuyerSession();
    if (session?.phone) {
      allowed = await phoneHasAccessToItem(session.phone, "webinar", webinar.slug);
    }
  }
  if (!allowed) return NextResponse.json({ ok: false, error: "No access to this recording" }, { status: 403 });

  try {
    const url = await signGetUrl(webinar.recording_key);
    return NextResponse.json({ ok: true, url, ttl: PLAYBACK_TTL });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not sign playback URL" }, { status: 500 });
  }
}
