/**
 * Cinematic home PREVIEW flag.
 *
 * The preview route `/home-cinematic` is OFF unless
 * `NEXT_PUBLIC_CINEMATIC_HOME_ENABLED` is exactly "true". Default is FALSE, so a
 * deploy that forgets the env var ships a 404 rather than an unfinished page.
 *
 * This is deliberately a NEXT_PUBLIC_ flag so the same answer is available to
 * the server component (for `notFound()`) and to client code (for the tier /
 * analytics layer) without a second source of truth.
 *
 * Rollback is an env change + redeploy — no code edit. See ROLLBACK below.
 *
 *   vercel env rm NEXT_PUBLIC_CINEMATIC_HOME_ENABLED production
 *
 * NOTE: this flag governs ONLY the preview route. Production `/` is untouched by
 * this module and keeps its own independent kill switch (`HOME_V2_DISABLE`).
 */
export const CINEMATIC_HOME_FLAG = "NEXT_PUBLIC_CINEMATIC_HOME_ENABLED" as const;

export function isCinematicHomeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CINEMATIC_HOME_ENABLED === "true";
}
