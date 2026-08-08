import { NextResponse } from "next/server";
import { getObject, publicCdnUrl, r2Configured } from "@/lib/r2";

/**
 * Public, unsigned media origin for R2 keys under `media/*`.
 * Stable URL → next/image cache key stays fixed (no 24h presigned churn).
 * When a CDN base is configured, 308 there so bytes leave Vercel entirely.
 */
export const runtime = "nodejs";

const LONG_CACHE = "public, max-age=31536000, immutable";

export async function GET(_req: Request, { params }: { params: { path: string[] } }) {
  const parts = params.path || [];
  if (!parts.length || parts.some((p) => !p || p === "." || p === "..")) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const key = `media/${parts.join("/")}`;

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

  const obj = await getObject(key);
  if (!obj) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const headers = new Headers();
  headers.set("Cache-Control", LONG_CACHE);
  headers.set("CDN-Cache-Control", LONG_CACHE);
  headers.set("Content-Type", obj.contentType || "application/octet-stream");
  if (obj.contentLength != null) headers.set("Content-Length", String(obj.contentLength));
  if (obj.etag) headers.set("ETag", obj.etag);

  return new NextResponse(obj.body.transformToWebStream(), { status: 200, headers });
}
