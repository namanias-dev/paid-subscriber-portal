import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

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

/**
 * Returns a Supabase admin client (service role) or null in demo mode.
 * Never throws — callers must handle null gracefully.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL") || readEnv("SUPABASE_URL");
  const key = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null; // demo mode
  if (!adminClient) {
    adminClient = createClient(url, key, { auth: { persistSession: false } });
  }
  return adminClient;
}
