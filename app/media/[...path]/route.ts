import { NextResponse } from "next/server";
import { getObject, headObject, publicCdnUrl, r2Configured } from "@/lib/r2";
import { mediaObjectKey, mediaResponseHeaders } from "@/lib/mediaDelivery";
import { isPublicMediaKey } from "@/lib/media/publicPrefix";

/**
 * Compatibility origin for R2 keys under `media/*` only.
 *
 * When CLOUDFLARE_R2_PUBLIC_BASE_URL / NEXT_PUBLIC_MEDIA_CDN_BASE is set,
 * PUBLIC keys 308 to the CDN so video/PDF/image bytes never leave Vercel.
 * Private prefixes are not addressable here (mediaObjectKey allowlists media/).
 *
 * Fallback stream (CDN unset) remains Range-aware for local/dev and rollback.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = ["bom1"];

function redirectToCdn(key: string): NextResponse | null {
  if (!isPublicMediaKey(key)) return null;
  const cdn = publicCdnUrl(key);
  if (!cdn) return null;
  return NextResponse.redirect(cdn, {
    status: 308,
    headers: { "Cache-Control": "public, max-age=86400", "X-Media-Redirect": "cdn" },
  });
}

export async function GET(req: Request, { params }: { params: { path: string[] } }) {
  const key = mediaObjectKey(params.path);
  if (!key) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const redirected = redirectToCdn(key);
  if (redirected) return redirected;

  if (!r2Configured()) {
    return NextResponse.json({ ok: false, error: "Storage not configured" }, { status: 503 });
  }

  const range = req.headers.get("range") || undefined;
  const obj = await getObject(key, { range });
  if (!obj) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  return new NextResponse(obj.body.transformToWebStream(), {
    status: obj.status,
    headers: mediaResponseHeaders(obj),
  });
}

export async function HEAD(_req: Request, { params }: { params: { path: string[] } }) {
  const key = mediaObjectKey(params.path);
  if (!key) {
    return new NextResponse(null, { status: 404 });
  }

  const redirected = redirectToCdn(key);
  if (redirected) return redirected;

  if (!r2Configured()) {
    return new NextResponse(null, { status: 503 });
  }

  const obj = await headObject(key);
  if (!obj) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(null, { status: 200, headers: mediaResponseHeaders(obj) });
}
