/**
 * Signed GET TTL for public /media → R2 redirects.
 * Shared by the media route and ops cost-health probes.
 */
export const PUBLIC_MEDIA_SIGNED_TTL_SECONDS = Math.max(
  1800,
  Number(process.env.PUBLIC_MEDIA_SIGNED_REDIRECT_TTL_SECONDS || 21600) || 21600,
);
