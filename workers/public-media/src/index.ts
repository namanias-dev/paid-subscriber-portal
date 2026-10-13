/**
 * Path-scoped public media Worker.
 *
 * Serves ONLY R2 keys under `media/*` from the private academy bucket.
 * Streams ranged GETs via the R2 binding (never buffers whole MP4s).
 *
 * Hostname target: media.namanias.com
 */

import { isPrivateR2Key, publicMediaKeyFromPathname } from "./publicKey";

export interface Env {
  MEDIA_BUCKET: R2Bucket;
  /** Comma-separated allowed CORS origins. Empty = reflect www/apex namanias only. */
  CORS_ORIGINS?: string;
}

const LONG_CACHE = "public, max-age=31536000, immutable";
const ALLOWED_METHODS = "GET, HEAD, OPTIONS";

function allowedOrigins(env: Env): string[] {
  const raw = (env.CORS_ORIGINS || "").trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return ["https://www.namanias.com", "https://namanias.com"];
}

function corsHeaders(req: Request, env: Env): Headers {
  const headers = new Headers();
  const origin = req.headers.get("Origin");
  const allow = allowedOrigins(env);
  if (origin && allow.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
    headers.set("Access-Control-Allow-Headers", "Range, If-None-Match, If-Modified-Since");
    headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return headers;
}

function withCors(res: Response, req: Request, env: Env): Response {
  const cors = corsHeaders(req, env);
  const headers = new Headers(res.headers);
  cors.forEach((v, k) => headers.set(k, v));
  // Preserve existing Vary and merge Origin when needed.
  if (cors.has("Vary")) {
    const prev = headers.get("Vary");
    if (prev && !/\bOrigin\b/i.test(prev)) headers.set("Vary", `${prev}, Origin`);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function guessContentType(key: string, fallback?: string): string {
  if (fallback) return fallback;
  const lower = key.toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".m4v")) return "video/x-m4v";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".vtt")) return "text/vtt";
  return "application/octet-stream";
}

function objectHeaders(
  object: R2Object,
  key: string,
  opts: { partial: boolean },
): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.get("Content-Type")) {
    headers.set("Content-Type", guessContentType(key, object.httpMetadata?.contentType));
  }
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", object.httpMetadata?.cacheControl || LONG_CACHE);
  headers.set("ETag", object.httpEtag);
  if (object.uploaded) headers.set("Last-Modified", object.uploaded.toUTCString());
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Public-Media", "1");

  if (opts.partial && object.range) {
    const range = object.range as { offset?: number; length?: number; suffix?: number };
    let start = 0;
    let length = object.size;
    if (typeof range.suffix === "number") {
      length = Math.min(range.suffix, object.size);
      start = Math.max(0, object.size - length);
    } else {
      start = range.offset ?? 0;
      length = range.length ?? Math.max(0, object.size - start);
    }
    const end = start + Math.max(0, length) - 1;
    headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
    headers.set("Content-Length", String(Math.max(0, length)));
    headers.set("Vary", "Range");
  } else {
    headers.set("Content-Length", String(object.size));
  }
  return headers;
}

async function serveObject(req: Request, env: Env, key: string): Promise<Response> {
  if (isPrivateR2Key(key) || !key.startsWith("media/")) {
    return new Response("Not found", { status: 404 });
  }

  if (req.method === "HEAD") {
    const head = await env.MEDIA_BUCKET.head(key);
    if (!head) return new Response("Not found", { status: 404 });
    return new Response(null, { status: 200, headers: objectHeaders(head, key, { partial: false }) });
  }

  // Pass Range headers through so R2 returns only the requested bytes.
  const object = await env.MEDIA_BUCKET.get(key, {
    range: req.headers,
    onlyIf: req.headers,
  });

  if (!object) return new Response("Not found", { status: 404 });

  // Conditional request satisfied without body.
  if (!("body" in object) || object.body == null) {
    return new Response(null, { status: 304, headers: objectHeaders(object as R2Object, key, { partial: false }) });
  }

  const partial = !!object.range || !!req.headers.get("Range");
  const status = partial ? 206 : 200;
  return new Response(object.body, {
    status,
    headers: objectHeaders(object, key, { partial }),
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") {
      const headers = corsHeaders(req, env);
      if (!headers.has("Access-Control-Allow-Origin")) {
        return new Response(null, { status: 204, headers: { Allow: ALLOWED_METHODS } });
      }
      return new Response(null, { status: 204, headers });
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return withCors(new Response("Method not allowed", { status: 405, headers: { Allow: ALLOWED_METHODS } }), req, env);
    }

    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return withCors(
        new Response(JSON.stringify({ ok: true, service: "naman-public-media", prefix: "media/" }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        }),
        req,
        env,
      );
    }

    const key = publicMediaKeyFromPathname(url.pathname);
    if (!key) {
      return withCors(new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } }), req, env);
    }

    try {
      const res = await serveObject(req, env, key);
      return withCors(res, req, env);
    } catch (err) {
      console.error("public-media error", (err as Error)?.message || err);
      return withCors(new Response("Storage error", { status: 502, headers: { "Cache-Control": "no-store" } }), req, env);
    }
  },
};
