import { NextResponse } from "next/server";
import { getContentById } from "@/lib/dataProvider";
import { resolveLectureAccess } from "@/lib/entitlements";
import { r2Configured, signGetUrl, publicCdnUrl, PLAYBACK_TTL } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Mint a short-lived signed playback URL — ONLY after re-checking access on the
 * server for THIS request (never trust the client). Public lectures bypass
 * entitlements; everyone else must pass canAccessLecture. The R2 key is never
 * returned. Bytes stream R2→browser directly (we only sign the URL).
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const rec = await getContentById(params.id);
  if (!rec || rec.source_type !== "hosted" || rec.upload_status !== "completed" || !rec.processed_key) {
    return NextResponse.json({ ok: false, error: "Lecture not available" }, { status: 404 });
  }
  if (!rec.is_published) return NextResponse.json({ ok: false, error: "Lecture not available" }, { status: 404 });
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "Playback not configured" }, { status: 503 });

  const { access } = await resolveLectureAccess(rec);
  if (!access.allowed) {
    return NextResponse.json({ ok: false, access }, { status: 403 });
  }

  try {
    // Public lecture explicitly opted into CDN caching → public URL; else signed GET.
    const url =
      rec.visibility === "public" && rec.public_cdn && publicCdnUrl(rec.processed_key)
        ? (publicCdnUrl(rec.processed_key) as string)
        : await signGetUrl(rec.processed_key);
    return NextResponse.json({ ok: true, url, ttl: PLAYBACK_TTL, access });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not sign playback URL" }, { status: 500 });
  }
}
