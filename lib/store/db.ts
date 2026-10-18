/**
 * The store's own database accessor.
 *
 * Exists so that store modules never import the academy data layer to get a
 * client — that single convenience import is how domain boundaries rot. Returns
 * null when Supabase is unconfigured, and every caller treats null as "the store
 * is closed" rather than crashing a page.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin, PUBLIC_DB_TIMEOUT_MS } from "@/lib/supabase";
import { NOTES_PUBLIC_REVALIDATE_SECONDS } from "@/lib/cost/notesPublicCache";
import { localFixtureClient, localFixtureEnabled } from "@/lib/store/localFixture";

export function storeDb(): SupabaseClient | null {
  // Local process only. VERCEL forces the real client, which is null when
  // Supabase is unset and the shared project when it is configured.
  if (localFixtureEnabled()) return localFixtureClient() as unknown as SupabaseClient;
  return getSupabaseAdmin();
}

let notesPublicClient: SupabaseClient | null = null;

function readEnv(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() !== "" ? v : undefined;
}

/**
 * Force-cache client for public Notes ISR wrappers only.
 * Tagged with notes-store so an admin catalogue edit drops the cached read.
 * Cart, checkout, orders, payments, and shipping must keep using storeDb().
 */
export function storePublicCacheDb(): SupabaseClient | null {
  if (localFixtureEnabled()) return localFixtureClient() as unknown as SupabaseClient;
  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL") || readEnv("SUPABASE_URL");
  const key = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  if (!notesPublicClient) {
    notesPublicClient = createClient(url, key, {
      auth: { persistSession: false },
      global: {
        fetch: (input, init) => {
          const controller = new AbortController();
          const timer = setTimeout(
            () => controller.abort(new Error(`supabase_fetch_timeout_${PUBLIC_DB_TIMEOUT_MS}ms`)),
            PUBLIC_DB_TIMEOUT_MS,
          );
          return fetch(input as RequestInfo, {
            ...(init || {}),
            cache: "force-cache",
            next: { revalidate: NOTES_PUBLIC_REVALIDATE_SECONDS, tags: ["notes-store"] },
            signal: controller.signal,
          }).finally(() => clearTimeout(timer));
        },
      },
    });
  }
  return notesPublicClient;
}

/** Convenience for paths that cannot proceed without a database. */
export function requireStoreDb(): SupabaseClient {
  const db = storeDb();
  if (!db) throw new Error("store: database unavailable");
  return db;
}
