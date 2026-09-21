import { NextResponse } from "next/server";
import { getObject, headObject, publicCdnUrl, r2Configured } from "@/lib/r2";
import { mediaObjectKey, mediaResponseHeaders } from "@/lib/mediaDelivery";

/**
 * Public, unsigned media origin for R2 keys under `media/*`.
 * Stable URL → next/image cache key stays fixed (no 24h presigned churn).
 * When a CDN base is configured, 308 there so bytes leave Vercel entirely.
 *
 * Video playback depends on this remaining a streaming Range proxy:
 * forward `Range` to R2, return 206 + Content-Range, and stream the body
 * instead of materializing the object in the serverless isolate.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = ["bom1"];

export async function GET(req: Request, { params }: { params: { path: string[] } }) {
  const key = mediaObjectKey(params.path);
  if (!key) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const cdn = publicCdnUrl(key);
  if (cdn) {
    return NextResponse.redirect(cdn, {
      status: 308,
      headers: { "Cache-Control": "public, max-age=86400" },
    });
  }

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

  const cdn = publicCdnUrl(key);
  if (cdn) {
    return NextResponse.redirect(cdn, {
      status: 308,
      headers: { "Cache-Control": "public, max-age=86400" },
    });
  }

  if (!r2Configured()) {
    return new NextResponse(null, { status: 503 });
  }

  const obj = await headObject(key);
  if (!obj) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(null, { status: 200, headers: mediaResponseHeaders(obj) });
}
