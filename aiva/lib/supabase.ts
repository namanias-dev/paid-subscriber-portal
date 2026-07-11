import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, hasDb } from "./env";

/**
 * AIVA's own service-role Supabase client against the SHARED database. Used read-only in v1.
 * Returns null when env is missing (AIVA then runs in a safe empty state instead of crashing).
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!hasDb()) return null;
  if (client) return client;
  client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, opts) => fetch(url, { ...opts, cache: "no-store" }) },
  });
  return client;
}
