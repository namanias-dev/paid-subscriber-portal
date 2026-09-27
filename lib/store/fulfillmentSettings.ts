/**
 * Auto-fulfillment switches. Stored on the notes_store_auto_fulfillment flag
 * so operations can pause a provider without a deploy. Credentials stay in env.
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import { invalidateStoreFlagCache, storeFeatureEnabled } from "./flags";

export const AUTO_FULFILL_FLAG = "notes_store_auto_fulfillment";

export interface FulfillmentSettings {
  auto: boolean;
  strategy: "CHEAPEST_ELIGIBLE";
  maxAttempts: number;
  shiprocket: boolean;
  delhivery: boolean;
  excluded: string[];
}

const DEFAULTS: FulfillmentSettings = {
  auto: false,
  strategy: "CHEAPEST_ELIGIBLE",
  maxAttempts: 3,
  shiprocket: true,
  delhivery: true,
  excluded: [],
};

function metaOf(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
}

export function parseFulfillmentSettings(
  row: { enabled?: boolean; scope?: string | null; kill_switch?: boolean; meta?: unknown } | null,
  storeLive: boolean,
): FulfillmentSettings {
  if (!row) return DEFAULTS;
  const meta = metaOf(row.meta);
  const max = Math.round(Number(meta.max_attempts));
  const excluded = Array.isArray(meta.excluded_carriers)
    ? meta.excluded_carriers.map((name) => String(name).trim()).filter(Boolean).slice(0, 20)
    : [];
  const live = storeLive && !row.kill_switch && !!row.enabled && String(row.scope || "off") !== "off";
  return {
    auto: live,
    strategy: "CHEAPEST_ELIGIBLE",
    maxAttempts: Number.isFinite(max) ? Math.min(3, Math.max(1, max)) : 3,
    shiprocket: meta.shiprocket !== false,
    delhivery: meta.delhivery !== false,
    excluded,
  };
}

export async function getFulfillmentSettings(): Promise<FulfillmentSettings> {
  const db = getSupabaseAdmin();
  if (!db) return DEFAULTS;
  const { data } = await db
    .from("app_feature_flags")
    .select("enabled,scope,kill_switch,meta")
    .eq("key", AUTO_FULFILL_FLAG)
    .maybeSingle();
  const storeLive = await storeFeatureEnabled("notes_store");
  return parseFulfillmentSettings(data, storeLive);
}

export async function setFulfillmentSettings(
  next: Partial<Pick<FulfillmentSettings, "auto" | "shiprocket" | "delhivery" | "excluded" | "maxAttempts">>,
  actor: { id?: string | null; name?: string | null },
): Promise<FulfillmentSettings> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("store: database unavailable");
  const current = await getFulfillmentSettings();
  const merged: FulfillmentSettings = {
    ...current,
    ...next,
    strategy: "CHEAPEST_ELIGIBLE",
    maxAttempts: Math.min(3, Math.max(1, next.maxAttempts ?? current.maxAttempts)),
    excluded: (next.excluded ?? current.excluded).map((name) => name.trim()).filter(Boolean).slice(0, 20),
  };
  const now = new Date().toISOString();
  const { error } = await db.from("app_feature_flags").upsert(
    {
      key: AUTO_FULFILL_FLAG,
      enabled: merged.auto,
      scope: merged.auto ? "all" : "off",
      kill_switch: false,
      meta: {
        strategy: merged.strategy,
        max_attempts: merged.maxAttempts,
        shiprocket: merged.shiprocket,
        delhivery: merged.delhivery,
        excluded_carriers: merged.excluded,
        last_changed_by_name: actor.name ?? null,
        last_changed_by_id: actor.id ?? null,
        last_changed_at: now,
      },
      updated_at: now,
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
  invalidateStoreFlagCache();
  return getFulfillmentSettings();
}
