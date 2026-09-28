/**
 * The store's own database accessor.
 *
 * Exists so that store modules never import the academy data layer to get a
 * client — that single convenience import is how domain boundaries rot. Returns
 * null when Supabase is unconfigured, and every caller treats null as "the store
 * is closed" rather than crashing a page.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { localFixtureClient, localFixtureEnabled } from "@/lib/store/localFixture";

export function storeDb(): SupabaseClient | null {
  // Local process only. VERCEL forces the real client, which is null when
  // Supabase is unset and the shared project when it is configured.
  if (localFixtureEnabled()) return localFixtureClient() as unknown as SupabaseClient;
  return getSupabaseAdmin();
}

/** Convenience for paths that cannot proceed without a database. */
export function requireStoreDb(): SupabaseClient {
  const db = storeDb();
  if (!db) throw new Error("store: database unavailable");
  return db;
}
