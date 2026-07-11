import { NextResponse } from "next/server";
import { getSession, type AivaSession } from "./session";
import { flags } from "./flags";
import { hasAuth } from "./env";

/**
 * API guard: returns the session or a NextResponse to short-circuit with. Super-admin only.
 * When auth is not configured, AIVA fails CLOSED (401) rather than open.
 */
export async function requireApiSession(): Promise<
  { session: AivaSession } | { response: NextResponse }
> {
  if (!flags.enabled) {
    return { response: NextResponse.json({ ok: false, error: "AIVA is disabled." }, { status: 503 }) };
  }
  if (!hasAuth()) {
    return {
      response: NextResponse.json(
        { ok: false, error: "AIVA auth is not configured (missing AIVA_JWT_SECRET/ADMIN_JWT_SECRET)." },
        { status: 401 },
      ),
    };
  }
  const session = await getSession();
  if (!session || !session.is_super) {
    return { response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  return { session };
}

/** Convenience for page-level checks. Returns the session or null. */
export async function pageSession(): Promise<AivaSession | null> {
  if (!flags.enabled) return null;
  return getSession();
}
