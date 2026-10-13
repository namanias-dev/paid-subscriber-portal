import { NextResponse } from "next/server";
import {
  getObject,
  headObject,
  publicCdnUrl,
  r2Configured,
  signGetUrl,
} from "@/lib/r2";
import { mediaObjectKey, mediaResponseHeaders } from "@/lib/mediaDelivery";
import { isPublicMediaKey } from "@/lib/media/publicPrefix";

/**
 * Compatibility origin for R2 keys under `media/*` only.
 *
 * Priority:
 * 1. When CLOUDFLARE_R2_PUBLIC_BASE_URL / NEXT_PUBLIC_MEDIA_CDN_BASE is set,
 *    PUBLIC keys 308 to the CDN Worker so video/PDF/image bytes never leave Vercel.
 * 2. Otherwise (CDN unset), PUBLIC keys 302 to a short-lived R2 signed GET URL so
 *    browsers pull bytes Browser→R2 directly. HTML/next/image keep stable
 *    `/media/…` srcs — only the redirect Location rotates.
 * 3. Stream fallback remains for local/dev when signing is unavailable.
 *
 * Private prefixes are not addressable here (mediaObjectKey allowlists media/).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = ["bom1"];

/**
 * Signed GET TTL for public media redirects.
 * 6h covers pause/seek on mobile for Notes Store clips (~3 min) and longer
 * study sessions without minting week-long URLs. Override via env.
 * (Not a Next.js route export — keep as module-local.)
 */
const PUBLIC_MEDIA_SIGNED_TTL_SECONDS = Math.max(
  1800,
  Number(process.env.PUBLIC_MEDIA_SIGNED_REDIRECT_TTL_SECONDS || 21600) || 21600,
);

const NO_STORE_REDIRECT = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "CDN-Cache-Control": "private, no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  // Avoid carrying navigational context into the signed R2 host.
  "Referrer-Policy": "no-referrer",
} as const;

function redirectToCdn(key: string): NextResponse | null {
  if (!isPublicMediaKey(key)) return null;
  const cdn = publicCdnUrl(key);
  if (!cdn) return null;
  return NextResponse.redirect(cdn, {
    status: 308,
    headers: {
      "Cache-Control": "public, max-age=86400",
      "X-Media-Redirect": "cdn",
    },
  });
}

async function redirectToSignedR2(key: string): Promise<NextResponse | null> {
  if (!isPublicMediaKey(key) || !r2Configured()) return null;
  try {
    // Refuse to mint signatures for missing keys (no open "exists?" oracle via 302→404).
    const head = await headObject(key);
    if (!head) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    const url = await signGetUrl(key, PUBLIC_MEDIA_SIGNED_TTL_SECONDS);
    // 302 (not 308): Location is a rotating signed URL and must not be cached as permanent.
    return NextResponse.redirect(url, {
      status: 302,
      headers: {
        ...NO_STORE_REDIRECT,
        "X-Media-Redirect": "r2-signed",
        "X-Media-Signed-TTL": String(PUBLIC_MEDIA_SIGNED_TTL_SECONDS),
      },
    });
  } catch (e) {
    console.error("[media] signed redirect failed:", (e as Error).message);
    return null;
  }
}

export async function GET(req: Request, { params }: { params: { path: string[] } }) {
  const key = mediaObjectKey(params.path);
  if (!key) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const cdn = redirectToCdn(key);
  if (cdn) return cdn;

  const signed = await redirectToSignedR2(key);
  if (signed) return signed;

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

  const cdn = redirectToCdn(key);
  if (cdn) return cdn;

  const signed = await redirectToSignedR2(key);
  if (signed) return signed;

  if (!r2Configured()) {
    return new NextResponse(null, { status: 503 });
  }

  const obj = await headObject(key);
  if (!obj) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(null, { status: 200, headers: mediaResponseHeaders(obj) });
}
