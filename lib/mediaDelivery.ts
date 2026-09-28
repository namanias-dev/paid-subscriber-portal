/**
 * Shared HTTP metadata for the public `/media/*` R2 stream.
 * Range responses must stay streaming — never materialize the object body
 * in the Next.js server. Helpers here are pure so tests can assert 206
 * headers without spinning a route handler.
 */
export const MEDIA_LONG_CACHE = "public, max-age=31536000, immutable";

export function mediaObjectKey(path: string[] | undefined): string | null {
  const parts = path || [];
  if (!parts.length || parts.some((p) => !p || p === "." || p === "..")) return null;
  return `media/${parts.join("/")}`;
}

export function mediaStatus(range: string | undefined, contentRange?: string): 200 | 206 {
  const hasRange = !!(range || "").trim();
  return hasRange && contentRange ? 206 : 200;
}

export function mediaResponseHeaders(obj: {
  contentType?: string;
  contentLength?: number;
  etag?: string;
  contentRange?: string;
}): Headers {
  const headers = new Headers();
  headers.set("Cache-Control", MEDIA_LONG_CACHE);
  headers.set("CDN-Cache-Control", MEDIA_LONG_CACHE);
  headers.set("Vercel-CDN-Cache-Control", MEDIA_LONG_CACHE);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Type", obj.contentType || "application/octet-stream");
  headers.set("Vary", "Range");
  headers.set("X-Content-Type-Options", "nosniff");
  if (obj.contentLength != null) headers.set("Content-Length", String(obj.contentLength));
  if (obj.contentRange) headers.set("Content-Range", obj.contentRange);
  if (obj.etag) headers.set("ETag", obj.etag);
  return headers;
}
