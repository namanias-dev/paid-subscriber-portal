/**
 * Notes Store launch control — the admin-facing read/write layer over the ONE
 * authoritative store switch (`app_feature_flags.notes_store`, see flags.ts).
 *
 * The business ON/OFF state lives entirely in the database so an Academy admin
 * can launch or hide the storefront instantly (within the flag memo TTL, no
 * deploy). `kill_switch` remains a separate emergency hard-stop and is preserved
 * untouched by the normal toggle. Production never honours the preview env var.
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import { storeDb } from "./db";
import { STORE_MASTER_FLAG, invalidateStoreFlagCache } from "./flags";

export interface StoreLaunchState {
  /** Business-live: enabled and in-scope and not hard-stopped. */
  live: boolean;
  enabled: boolean;
  scope: string;
  killSwitch: boolean;
  updatedAt: string | null;
  lastChangedByName: string | null;
  lastChangedAt: string | null;
}

export interface StoreReadiness {
  liveProducts: number;
  withCovers: number;
  withSamples: number;
  readyStock: number;
  onDemand: number;
  comingSoon: number;
  unavailable: number;
  bundlesLive: number;
  /** Non-blocking marketing gaps worth surfacing. */
  warnings: string[];
  /** Hard blockers that must be resolved before the store can go live. */
  blockers: string[];
}

const EMPTY_STATE: StoreLaunchState = {
  live: false,
  enabled: false,
  scope: "off",
  killSwitch: false,
  updatedAt: null,
  lastChangedByName: null,
  lastChangedAt: null,
};

function toState(row: {
  enabled?: boolean;
  scope?: string | null;
  kill_switch?: boolean;
  meta?: unknown;
  updated_at?: string | null;
} | null): StoreLaunchState {
  if (!row) return EMPTY_STATE;
  const enabled = !!row.enabled;
  const scope = String(row.scope || "off");
  const killSwitch = !!row.kill_switch;
  const meta = row.meta && typeof row.meta === "object" ? (row.meta as Record<string, unknown>) : {};
  return {
    live: !killSwitch && enabled && scope !== "off",
    enabled,
    scope,
    killSwitch,
    updatedAt: row.updated_at ?? null,
    lastChangedByName: (meta.last_changed_by_name as string) ?? null,
    lastChangedAt: (meta.last_changed_at as string) ?? null,
  };
}

/** Current persisted launch state of the store master flag. */
export async function getStoreLaunchState(): Promise<StoreLaunchState> {
  const db = getSupabaseAdmin();
  if (!db) return EMPTY_STATE;
  const { data } = await db
    .from("app_feature_flags")
    .select("enabled,scope,kill_switch,meta,updated_at")
    .eq("key", STORE_MASTER_FLAG)
    .maybeSingle();
  return toState(data as Parameters<typeof toState>[0]);
}

/**
 * Flip the store live/offline. Preserves `kill_switch` (a separate emergency
 * safeguard) and records who/when in the flag's meta. Invalidates the flag memo
 * so the change is effectively immediate. Never mutates product/order data.
 */
export async function setStoreLaunch(
  live: boolean,
  actor: { id?: string | null; name?: string | null },
): Promise<StoreLaunchState> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("store: database unavailable");
  const now = new Date().toISOString();

  const { data: existing } = await db
    .from("app_feature_flags")
    .select("meta,kill_switch")
    .eq("key", STORE_MASTER_FLAG)
    .maybeSingle();

  const meta =
    existing?.meta && typeof existing.meta === "object" ? { ...(existing.meta as Record<string, unknown>) } : {};
  meta.last_changed_by_name = actor.name ?? null;
  meta.last_changed_by_id = actor.id ?? null;
  meta.last_changed_at = now;

  const { error } = await db.from("app_feature_flags").upsert(
    {
      key: STORE_MASTER_FLAG,
      enabled: live,
      scope: live ? "all" : "off",
      // Preserve the emergency hard-stop; the business toggle never changes it.
      kill_switch: !!existing?.kill_switch,
      meta,
      updated_at: now,
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);

  invalidateStoreFlagCache();
  return getStoreLaunchState();
}

/**
 * Pre-launch readiness. Live = published (`is_active`) and not archived. Covers
 * and sample previews are surfaced as warnings (not blockers); genuine blockers
 * are "no live products" and invalid pricing on a purchasable product.
 */
export async function getStoreReadiness(): Promise<StoreReadiness> {
  const empty: StoreReadiness = {
    liveProducts: 0,
    withCovers: 0,
    withSamples: 0,
    readyStock: 0,
    onDemand: 0,
    comingSoon: 0,
    unavailable: 0,
    bundlesLive: 0,
    warnings: [],
    blockers: [],
  };
  const db = storeDb();
  if (!db) return { ...empty, blockers: ["Store database is not configured."] };

  const { data: products } = await db
    .from("store_products")
    .select("id,name,kind,availability_mode,cover_image_key,mrp_paise,selling_price_paise")
    .eq("is_active", true)
    .is("archived_at", null);
  const live = products || [];

  // Which live products have at least one sample-page preview.
  const ids = live.map((p) => p.id);
  const withSampleIds = new Set<string>();
  if (ids.length) {
    const { data: samples } = await db
      .from("store_product_media")
      .select("product_id")
      .eq("kind", "sample_page")
      .in("product_id", ids);
    for (const s of samples || []) withSampleIds.add(s.product_id as string);
  }

  const r: StoreReadiness = { ...empty, liveProducts: live.length };
  const noCover: string[] = [];
  const noSample: string[] = [];
  for (const p of live) {
    const mode = String(p.availability_mode || "ready_stock");
    if (mode === "ready_stock") r.readyStock += 1;
    else if (mode === "on_demand") r.onDemand += 1;
    else if (mode === "coming_soon") r.comingSoon += 1;
    else if (mode === "unavailable") r.unavailable += 1;
    if (p.kind === "bundle") r.bundlesLive += 1;
    if (p.cover_image_key) r.withCovers += 1;
    else noCover.push(p.name as string);
    if (withSampleIds.has(p.id as string)) r.withSamples += 1;
    else noSample.push(p.name as string);

    const purchasable = mode === "ready_stock" || mode === "on_demand";
    const selling = Number(p.selling_price_paise || 0);
    const mrp = Number(p.mrp_paise || 0);
    if (purchasable && selling <= 0) r.blockers.push(`${p.name}: no selling price set.`);
    if (mrp > 0 && selling > mrp) r.blockers.push(`${p.name}: selling price is higher than MRP.`);
  }

  if (r.liveProducts === 0) r.blockers.unshift("No live products — publish at least one before launching.");

  const summarize = (names: string[], suffix: string): string | null => {
    if (!names.length) return null;
    if (names.length <= 2) return `${names.join(", ")} ${suffix}`;
    return `${names.slice(0, 2).join(", ")} +${names.length - 2} more ${suffix}`;
  };
  const wCover = summarize(noCover, noCover.length === 1 ? "has no cover image." : "have no cover image.");
  const wSample = summarize(noSample, noSample.length === 1 ? "has no sample preview." : "have no sample preview.");
  if (wCover) r.warnings.push(wCover);
  if (wSample) r.warnings.push(wSample);

  return r;
}
