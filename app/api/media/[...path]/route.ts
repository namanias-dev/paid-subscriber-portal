import { NextResponse } from "next/server";
import { publicCdnUrl, r2Configured } from "@/lib/r2";
import { stablePublicMediaUrl } from "@/lib/publicMediaUrl";

/**
 * Legacy media proxy. Public `media/*` assets must NOT 302 to presigned R2 URLs
 * (that poisoned next/image cache keys with rotating X-Amz-* params).
 *
 * Behaviour: 308 to the stable public URL (CDN or `/media/…`). Keep this route
 * for old bookmarks / PDF links; new uploads and next/image sources should use
 * `/media/…` or the CDN directly — never this path as an image optimizer source.
 */
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { path: string[] } }) {
  const parts = params.path || [];
  if (!parts.length || parts.some((p) => !p || p === "." || p === "..")) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const key = `media/${parts.join("/")}`;

  if (!r2Configured() && !publicCdnUrl(key)) {
    return NextResponse.json({ ok: false, error: "Storage not configured" }, { status: 503 });
  }

  const dest = publicCdnUrl(key) || stablePublicMediaUrl(key);
  return NextResponse.redirect(dest, {
    status: 308,
    headers: { "Cache-Control": "public, max-age=86400" },
  });
}
