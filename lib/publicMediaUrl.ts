/**
 * Stable, unsigned public URLs for R2 `media/*` assets (covers, logos, hero
 * portrait, …). next/image must NEVER see a presigned R2 URL (X-Amz-* query
 * params rotate every TTL and thrash the optimizer cache).
 *
 * Prefer CLOUDFLARE_R2_PUBLIC_BASE_URL / NEXT_PUBLIC_MEDIA_CDN_BASE when set;
 * otherwise serve via same-origin `/media/<rest>` (streams from R2, no signing).
 * Safe to import from client components (no R2 SDK).
 */

const SITE_MEDIA_ORIGIN = "https://www.namanias.com";

/** Public CDN origin (no trailing slash), or "" when unset. */
export function mediaCdnBase(): string {
  return (
    process.env.NEXT_PUBLIC_MEDIA_CDN_BASE ||
    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
}

/** Absolute public URL for an R2 key under `media/…`. */
export function stablePublicMediaUrl(keyOrRest: string): string {
  const rest = (keyOrRest || "")
    .replace(/^\/+/, "")
    .replace(/^media\//, "")
    .split("?")[0];
  if (!rest) return SITE_MEDIA_ORIGIN;
  const cdn = mediaCdnBase();
  if (cdn) return `${cdn}/media/${rest}`;
  return `${SITE_MEDIA_ORIGIN}/media/${rest}`;
}

/**
 * Rewrite a stored media URL for next/image / <img>.
 * - `/api/media/…` and `/media/…` → CDN or stable `/media/…`
 * - Presigned `*.r2.cloudflarestorage.com` with a `media/` key → same
 * - Apex namanias.com → www (skip 308 hop)
 * - Supabase / other hosts pass through (query stripped only for R2)
 */
export function toPublicImageSrc(url?: string | null): string | undefined {
  const raw = (url || "").trim();
  if (!raw) return undefined;

  try {
    const u = new URL(raw, SITE_MEDIA_ORIGIN);
    const path = u.pathname;

    const apiIdx = path.indexOf("/api/media/");
    if (apiIdx !== -1) {
      const rest = path.slice(apiIdx + "/api/media/".length).replace(/^\/+/, "");
      return rest ? stablePublicMediaUrl(rest) : undefined;
    }

    // Exact public stream path (not /api/media).
    if (path === "/media" || path.startsWith("/media/")) {
      const rest = path.slice("/media/".length).replace(/^\/+/, "");
      return rest ? stablePublicMediaUrl(rest) : undefined;
    }

    if (u.hostname.endsWith(".r2.cloudflarestorage.com")) {
      let p = path.replace(/^\/+/, "");
      const m = p.match(/(?:^|\/)(media\/.+)$/);
      if (!m) return undefined; // never feed signed non-media URLs to next/image
      return stablePublicMediaUrl(m[1]);
    }

    const cdn = mediaCdnBase();
    if (cdn && raw.startsWith(cdn + "/")) {
      return raw.split("?")[0];
    }

    if (/^https?:\/\/namanias\.com\//i.test(raw)) {
      return raw.replace(/^https?:\/\/namanias\.com\//i, `${SITE_MEDIA_ORIGIN}/`);
    }

    return raw;
  } catch {
    return raw;
  }
}
