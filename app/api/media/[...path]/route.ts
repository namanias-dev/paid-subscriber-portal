import { NextResponse } from "next/server";
import { publicCdnUrl, signGetUrl, r2Configured } from "@/lib/r2";

/**
 * Public serving proxy for R2-hosted media assets (images, PDFs, covers, logos,
 * brochures …). Uploaded via /api/admin/upload. Keys live under `media/`.
 *
 * Fast path: if a public CDN base is configured, redirect straight to it.
 * Fallback: 302-redirect to a short-lived signed GET URL so assets serve even
 * without a public bucket domain. The redirect itself is browser-cacheable, so
 * repeat views don't keep hitting this function.
 *
 * This is additive — old Supabase public URLs stored in the DB are absolute and
 * continue to serve directly from Supabase, untouched.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_TTL = 60 * 60 * 24; // 24h

export async function GET(_req: Request, { params }: { params: { path: string[] } }) {
  const parts = params.path || [];
  // Reject traversal / empty segments; only serve under the public media prefix.
  if (!parts.length || parts.some((p) => !p || p === "." || p === "..")) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const key = `media/${parts.join("/")}`;

  if (!r2Configured()) {
    return NextResponse.json({ ok: false, error: "Storage not configured" }, { status: 503 });
  }

  const cdn = publicCdnUrl(key);
  if (cdn) {
    return NextResponse.redirect(cdn, { status: 302, headers: { "Cache-Control": "public, max-age=3600" } });
  }

  try {
    const url = await signGetUrl(key, SIGNED_TTL);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "public, max-age=3600" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
}
