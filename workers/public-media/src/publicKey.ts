/**
 * Duplicated allowlist helpers for the Worker isolate (no Next.js path alias).
 * Keep in sync with `lib/media/publicPrefix.ts` — unit tests cover both.
 */

export const PUBLIC_MEDIA_PREFIX = "media/";

export function isSafePathSegment(segment: string): boolean {
  if (!segment || segment === "." || segment === "..") return false;
  if (segment.includes("\\") || segment.includes("\0")) return false;
  if (/%2e/i.test(segment) || /%2f/i.test(segment) || /%5c/i.test(segment)) return false;
  return true;
}

export function publicMediaKeyFromPathname(pathname: string): string | null {
  let path = (pathname || "").trim();
  if (!path) return null;
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
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
  if (key.includes("://") || key.startsWith("/")) return null;
  return key;
}

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
