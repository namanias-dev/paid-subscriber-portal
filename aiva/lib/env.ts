/**
 * AIVA environment access. AIVA shares the portal's Supabase project (same tables) but has
 * its own auth secret and its own env namespace. All secrets are server-only.
 */

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  /** AIVA session secret. Falls back to the portal admin secret if a dedicated one is not set. */
  sessionSecret: process.env.AIVA_JWT_SECRET || process.env.ADMIN_JWT_SECRET || "",
  sessionDays: Number(process.env.AIVA_SESSION_DAYS || 7),
  isProd: process.env.NODE_ENV === "production",
};

/** True when AIVA has a live DB connection. When false, AIVA runs in a safe demo/empty mode. */
export function hasDb(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}

/** True when AIVA can mint/verify sessions. */
export function hasAuth(): boolean {
  return Boolean(env.sessionSecret);
}
