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
 * Admin/API: always live (no-store). Public: allow the Data Cache so
 * unstable_cache / ISR pages can prerender — public getters wrap these reads
 * with tags (lib/publicCache.ts). Do not call getSupabasePublic from a public
 * RSC without an unstable_cache wrapper.
 */
function makeTimedFetch(timeoutMs: number, mode: "admin" | "public"): typeof fetch {
  return (input, init) => {
    const controller = new AbortController();
    const parent = init?.signal;
    if (parent) {
      if (parent.aborted) controller.abort(parent.reason);
      else parent.addEventListener("abort", () => controller.abort(parent.reason), { once: true });
    }
    const timer = setTimeout(() => controller.abort(new Error(`supabase_fetch_timeout_${timeoutMs}ms`)), timeoutMs);
    const cacheInit =
      mode === "admin"
        ? { cache: "no-store" as RequestCache }
        : { cache: "force-cache" as RequestCache, next: { revalidate: 600 } };
    return fetch(input as RequestInfo, {
      ...(init || {}),
      ...cacheInit,
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
      global: { fetch: makeTimedFetch(ADMIN_DB_TIMEOUT_MS, "admin") },
    });
  }
  return adminClient;
}

/**
 * Public/read-mostly client — shorter timeout so visitor pages fail fast and
 * degrade instead of competing with admin/automation for hung connections.
 * Same service-role key (no anon role in this app); isolation is timeout + pool
 * release, not credentials. Fetch uses force-cache so ISR/unstable_cache can
 * prerender; always wrap public RSC reads in unstable_cache with tags.
 */
export function getSupabasePublic(): SupabaseClient | null {
  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL") || readEnv("SUPABASE_URL");
  const key = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  if (!publicClient) {
    publicClient = createClient(url, key, {
      auth: { persistSession: false },
      global: { fetch: makeTimedFetch(PUBLIC_DB_TIMEOUT_MS, "public") },
    });
  }
  return publicClient;
}
