/**
 * Public R2 key allowlist for Notes Store / site media.
 *
 * ONLY keys under `media/` may be served without auth (via CDN Worker or
 * `/media/[...path]`). Everything else in the private bucket stays private:
 * processed/, payment-proofs/, installment-proofs/, store-private/, notes/, etc.
 *
 * Pure helpers — safe for Next.js and the Cloudflare Worker bundle.
 */

export const PUBLIC_MEDIA_PREFIX = "media/";

/** Reject path segments that escape or confuse object-key mapping. */
export function isSafePathSegment(segment: string): boolean {
  if (!segment || segment === "." || segment === "..") return false;
  if (segment.includes("\\") || segment.includes("\0")) return false;
  // Encoded traversal / weirdness after decode should already be normalized by callers.
  if (/%2e/i.test(segment) || /%2f/i.test(segment) || /%5c/i.test(segment)) return false;
  return true;
}

/**
 * Map a URL pathname to a public R2 object key, or null if not allowlisted.
 * Accepts `/media/...` or `media/...`.
 */
export function publicMediaKeyFromPathname(pathname: string): string | null {
  let path = (pathname || "").trim();
  if (!path) return null;
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  // Normalize repeated slashes and strip query/hash if a full URL slipped in.
  path = path.split("?")[0].split("#")[0].replace(/\\/g, "/");
  while (path.includes("//")) path = path.replace(/\/\//g, "/");
  if (!path.startsWith("/")) path = `/${path}`;

  if (path === "/media" || path === "/media/") return null;
  if (!path.startsWith("/media/")) return null;

  const rest = path.slice("/media/".length);
  const parts = rest.split("/").filter(Boolean);
  if (!parts.length || parts.some((p) => !isSafePathSegment(p))) return null;

  const key = `${PUBLIC_MEDIA_PREFIX}${parts.join("/")}`;
  if (!key.startsWith(PUBLIC_MEDIA_PREFIX) || key.includes("..")) return null;
  // Defense in depth: never allow absolute or scheme-like keys.
  if (key.includes("://") || key.startsWith("/")) return null;
  return key;
}

/** True when an R2 object key is eligible for anonymous public CDN delivery. */
export function isPublicMediaKey(key: string | null | undefined): boolean {
  const k = (key || "").trim();
  if (!k.startsWith(PUBLIC_MEDIA_PREFIX)) return false;
  if (k.includes("..") || k.includes("\\") || k.includes("\0")) return false;
  const parts = k.split("/");
  return parts.every((p) => isSafePathSegment(p));
}

/** Private prefixes that must never be exposed via the public media Worker. */
export const PRIVATE_R2_PREFIXES = [
  "processed/",
  "thumbnails/",
  "notes/",
  "payment-proofs/",
  "installment-proofs/",
  "store-private/",
  "careers/",
] as const;

export function isPrivateR2Key(key: string): boolean {
  const k = (key || "").trim();
  return PRIVATE_R2_PREFIXES.some((p) => k.startsWith(p));
}
