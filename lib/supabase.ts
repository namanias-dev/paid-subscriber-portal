import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;
let publicClient: SupabaseClient | null = null;

/**
 * Read env vars via computed access so Next.js does NOT inline them at build
 * time (it only inlines literal `process.env.NEXT_PUBLIC_*` references). This
 * makes Supabase activate as soon as the vars are present in the RUNTIME
 * environment — even if the production build was created before they were set.
 */
function readEnv(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() !== "" ? v : undefined;
}

/** Default statement/request budget for public traffic (ms). */
export const PUBLIC_DB_TIMEOUT_MS = Number(process.env.PUBLIC_DB_TIMEOUT_MS || 2_500);
/**
 * Admin/cron budget. Kept tight during SEV1 so hung queries release the pool
 * instead of stacking 504s. Raise via ADMIN_DB_TIMEOUT_MS after stability returns.
 */
export const ADMIN_DB_TIMEOUT_MS = Number(process.env.ADMIN_DB_TIMEOUT_MS || 5_000);

/**
 * Shared clients always use cache:"no-store". Public ISR must wrap reads in
 * explicit unstable_cache (lib/publicCache.ts / dataProvider) — never rely on
 * a fetch-cache default on this shared client (that opts every call site in).
 */
function makeTimedFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const controller = new AbortController();
    const parent = init?.signal;
    if (parent) {
      if (parent.aborted) controller.abort(parent.reason);
      else parent.addEventListener("abort", () => controller.abort(parent.reason), { once: true });
    }
    const timer = setTimeout(() => controller.abort(new Error(`supabase_fetch_timeout_${timeoutMs}ms`)), timeoutMs);
    return fetch(input as RequestInfo, {
      ...(init || {}),
      cache: "no-store",
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  };
}

/**
 * Returns a Supabase admin client (service role) or null in demo mode.
 * Never throws — callers must handle null gracefully.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL") || readEnv("SUPABASE_URL");
  const key = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null; // demo mode
  if (!adminClient) {
    adminClient = createClient(url, key, {
      auth: { persistSession: false },
      global: { fetch: makeTimedFetch(ADMIN_DB_TIMEOUT_MS) },
    });
  }
  return adminClient;
}

/**
 * Public/read-mostly client — shorter timeout so visitor pages fail fast and
 * degrade instead of competing with admin/automation for hung connections.
 * Same service-role key (no anon role in this app); isolation is timeout + pool
 * release, not credentials. Fetch is always no-store; ISR uses tagged
 * unstable_cache at each safe call site.
 */
export function getSupabasePublic(): SupabaseClient | null {
  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL") || readEnv("SUPABASE_URL");
  const key = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  if (!publicClient) {
    publicClient = createClient(url, key, {
      auth: { persistSession: false },
      global: { fetch: makeTimedFetch(PUBLIC_DB_TIMEOUT_MS) },
    });
  }
  return publicClient;
}
