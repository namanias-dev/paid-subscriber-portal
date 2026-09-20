import { NextResponse } from "next/server";
import { getObject, headObject, publicCdnUrl, r2Configured } from "@/lib/r2";

/**
 * Public, unsigned media origin for R2 keys under `media/*`.
 * Stable URL → next/image cache key stays fixed (no 24h presigned churn).
 * When a CDN base is configured, 308 there so bytes leave Vercel entirely.
 */
export const runtime = "nodejs";

const LONG_CACHE = "public, max-age=31536000, immutable";

function mediaKey(path: string[] | undefined): string | null {
  const parts = path || [];
  if (!parts.length || parts.some((p) => !p || p === "." || p === "..")) return null;
  return `media/${parts.join("/")}`;
}

function cacheHeaders(obj: { contentType?: string; contentLength?: number; etag?: string; contentRange?: string }) {
  const headers = new Headers();
  headers.set("Cache-Control", LONG_CACHE);
  headers.set("CDN-Cache-Control", LONG_CACHE);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Type", obj.contentType || "application/octet-stream");
  if (obj.contentLength != null) headers.set("Content-Length", String(obj.contentLength));
  if (obj.contentRange) headers.set("Content-Range", obj.contentRange);
  if (obj.etag) headers.set("ETag", obj.etag);
  return headers;
}

export async function GET(req: Request, { params }: { params: { path: string[] } }) {
  const key = mediaKey(params.path);
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
    headers: cacheHeaders(obj),
  });
}

export async function HEAD(_req: Request, { params }: { params: { path: string[] } }) {
  const key = mediaKey(params.path);
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

  return new NextResponse(null, { status: 200, headers: cacheHeaders(obj) });
}
