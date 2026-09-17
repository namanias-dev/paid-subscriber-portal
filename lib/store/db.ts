/**
 * The store's own database accessor.
 *
 * Exists so that store modules never import the academy data layer to get a
 * client — that single convenience import is how domain boundaries rot. Returns
 * null when Supabase is unconfigured, and every caller treats null as "the store
 * is closed" rather than crashing a page.
 */
import { getSupabaseAdmin } from "@/lib/supabase";

export function storeDb() {
  return getSupabaseAdmin();
}

/** Convenience for paths that cannot proceed without a database. */
export function requireStoreDb() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("store: database unavailable");
  return db;
}
