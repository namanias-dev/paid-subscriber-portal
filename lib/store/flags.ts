/**
 * Notes Store feature flags and master kill switch (§23).
 *
 * One flag — `notes_store` — turns the entire store dark: every customer route
 * 404s, checkout refuses, the Verify cron stops. It is read from the existing
 * app_feature_flags table, so flipping it is a data edit and takes effect within
 * seconds without a deploy.
 *
 * `kill_switch = true` wins over `enabled = true`, matching how the academy's
 * existing flags behave, so an operator can hard-stop the store without first
 * working out how it was configured.
 *
 * Reads are memoised for 20 seconds. That bounds the database load of checking a
 * flag on every request while keeping the switch effectively immediate.
 *
 * Preview can enable the storefront via `NOTES_STORE_PREVIEW_ENABLE=1` without
 * flipping the shared database flag. Production never honours that env var.
 */
import { getSupabaseAdmin } from "@/lib/supabase";

export const STORE_MASTER_FLAG = "notes_store";

export type StoreFlagKey =
  | "notes_store"
  | "notes_store_coupons"
  | "notes_store_free_shipping"
  | "notes_store_reviews"
  | "notes_store_shiprocket"
  | "notes_store_sms"
  | "notes_store_qr_bonuses"
  | "notes_store_preorders";

interface FlagRow {
  enabled: boolean;
  killSwitch: boolean;
  scope: string;
}

const OFF: FlagRow = { enabled: false, killSwitch: false, scope: "off" };
const TTL_MS = 20_000;

let cache: { at: number; rows: Map<string, FlagRow> } | null = null;

async function loadFlags(): Promise<Map<string, FlagRow>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = new Map<string, FlagRow>();
  const db = getSupabaseAdmin();
  if (!db) {
    // Unconfigured environment: the store stays dark rather than open.
    cache = { at: Date.now(), rows };
    return rows;
  }
  const { data } = await db
    .from("app_feature_flags")
    .select("key,enabled,scope,kill_switch")
    .like("key", "notes_store%");
  for (const r of data || []) {
    rows.set(String(r.key), {
      enabled: !!r.enabled,
      killSwitch: !!r.kill_switch,
      scope: String(r.scope || "off"),
    });
  }
  cache = { at: Date.now(), rows };
  return rows;
}

/** Drop the memo. Called by admin writes that flip a flag. */
export function invalidateStoreFlagCache(): void {
  cache = null;
}

async function flagRow(key: StoreFlagKey): Promise<FlagRow> {
  const rows = await loadFlags();
  return rows.get(key) ?? OFF;
}

function live(row: FlagRow): boolean {
  if (row.killSwitch) return false;
  return row.enabled && row.scope !== "off";
}

/**
 * Preview-only override. Production (`VERCEL_ENV === "production"`) never honours
 * this, even if the env var is accidentally set there. Preview and local can
 * open the storefront without flipping the shared `notes_store` database flag,
 * which would otherwise light production too.
 *
 * `kill_switch = true` still wins everywhere, including preview.
 */
export function storePreviewOverrideAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.VERCEL_ENV || "") === "production") return false;
  const v = (env.NOTES_STORE_PREVIEW_ENABLE || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function evaluateStoreEnabled(
  row: { enabled: boolean; killSwitch: boolean; scope: string },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (row.killSwitch) return false;
  if (row.enabled && row.scope !== "off") return true;
  return storePreviewOverrideAllowed(env);
}

/**
 * Is the store open at all? Every customer-facing store route and every store
 * write path calls this first. A false answer means the store does not exist.
 */
export async function storeEnabled(): Promise<boolean> {
  return evaluateStoreEnabled(await flagRow(STORE_MASTER_FLAG));
}

/** A sub-feature is live only if the master switch is also live. */
export async function storeFeatureEnabled(key: StoreFlagKey): Promise<boolean> {
  if (key === STORE_MASTER_FLAG) return storeEnabled();
  if (!(await storeEnabled())) return false;
  return live(await flagRow(key));
}
