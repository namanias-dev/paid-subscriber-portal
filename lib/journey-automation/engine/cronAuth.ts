/**
 * Pure cron authorization for the journey engine. FAIL-CLOSED: a missing
 * CRON_SECRET or a mismatched/absent credential is REJECTED. The engine drains
 * real events, so an unauthenticated route is never allowed to run.
 * Accepts the secret via `?secret=` or `Authorization: Bearer <secret>`.
 */
export function authorizeCron(req: Request, secret: string | undefined | null): boolean {
  if (!secret) return false;
  let provided: string | null = null;
  try {
    provided = new URL(req.url).searchParams.get("secret");
  } catch {
    provided = null;
  }
  if (!provided) {
    const auth = req.headers.get("authorization");
    if (auth) provided = auth.replace(/^Bearer\s+/i, "");
  }
  return provided === secret;
}
