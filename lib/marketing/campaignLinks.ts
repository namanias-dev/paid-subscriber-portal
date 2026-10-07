/**
 * SERVER module for the Campaign Links feature: CRUD over `campaign_links`, the
 * fast redirect lookup, and best-effort click logging into `campaign_link_clicks`.
 *
 * Isolated from the giant dataProvider on purpose (mirrors lib/store/*). Uses the
 * service-role admin client directly. Never throws out of the click logger — the
 * redirect must always reach the visitor even if logging fails.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  normalizeUtmValue,
  normalizeShortCode,
  isValidShortCode,
  randomShortCode,
  slugSeedFromName,
  isSafeDestination,
} from "./campaignLink";

export type CampaignLinkStatus = "active" | "paused" | "archived";
export type DestinationType = "webinar" | "notes" | "course" | "demo" | "landing" | "custom";

export interface CampaignLink {
  id: string;
  short_code: string;
  destination_url: string;
  destination_type: DestinationType;
  destination_id: string | null;
  name: string;
  description: string | null;
  status: CampaignLinkStatus;
  source: string | null;
  medium: string | null;
  platform: string | null;
  campaign: string | null;
  campaign_id_external: string | null;
  adset_name: string | null;
  adset_id_external: string | null;
  ad_name: string | null;
  ad_id_external: string | null;
  creative_name: string | null;
  content: string | null;
  term: string | null;
  placement: string | null;
  channel: string | null;
  tags: string[];
  owner: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface CampaignLinkInput {
  name: string;
  destination_url: string;
  destination_type?: DestinationType;
  destination_id?: string | null;
  description?: string | null;
  customAlias?: string | null;
  source?: string | null;
  medium?: string | null;
  platform?: string | null;
  campaign?: string | null;
  campaign_id_external?: string | null;
  adset_name?: string | null;
  adset_id_external?: string | null;
  ad_name?: string | null;
  ad_id_external?: string | null;
  creative_name?: string | null;
  content?: string | null;
  term?: string | null;
  placement?: string | null;
  channel?: string | null;
  tags?: string[];
  owner?: string | null;
  created_by?: string | null;
}

const TABLE = "campaign_links";
const CLICKS = "campaign_link_clicks";

const slug = (v: string | null | undefined): string | null => {
  const s = normalizeUtmValue(v);
  return s || null;
};

function rowToLink(r: Record<string, unknown>): CampaignLink {
  return {
    id: String(r.id),
    short_code: String(r.short_code),
    destination_url: String(r.destination_url),
    destination_type: (r.destination_type as DestinationType) || "custom",
    destination_id: (r.destination_id as string) ?? null,
    name: String(r.name ?? ""),
    description: (r.description as string) ?? null,
    status: (r.status as CampaignLinkStatus) || "active",
    source: (r.source as string) ?? null,
    medium: (r.medium as string) ?? null,
    platform: (r.platform as string) ?? null,
    campaign: (r.campaign as string) ?? null,
    campaign_id_external: (r.campaign_id_external as string) ?? null,
    adset_name: (r.adset_name as string) ?? null,
    adset_id_external: (r.adset_id_external as string) ?? null,
    ad_name: (r.ad_name as string) ?? null,
    ad_id_external: (r.ad_id_external as string) ?? null,
    creative_name: (r.creative_name as string) ?? null,
    content: (r.content as string) ?? null,
    term: (r.term as string) ?? null,
    placement: (r.placement as string) ?? null,
    channel: (r.channel as string) ?? null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    owner: (r.owner as string) ?? null,
    created_by: (r.created_by as string) ?? null,
    created_at: String(r.created_at ?? new Date().toISOString()),
    updated_at: String(r.updated_at ?? new Date().toISOString()),
    archived_at: (r.archived_at as string) ?? null,
  };
}

/** Does a (case-insensitive) short code already exist? */
async function codeTaken(code: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data } = await db.from(TABLE).select("id").ilike("short_code", code).limit(1);
  return !!(data && data.length);
}

/** Allocate a unique short code: custom alias (validated) or generated from name. */
export async function allocateShortCode(name: string, customAlias?: string | null): Promise<string> {
  if (customAlias && customAlias.trim()) {
    const alias = normalizeShortCode(customAlias);
    if (!isValidShortCode(alias)) throw new Error("Invalid custom alias.");
    if (await codeTaken(alias)) throw new Error("That alias is already in use.");
    return alias;
  }
  const seed = slugSeedFromName(name);
  for (let i = 0; i < 6; i++) {
    const candidate = seed ? `${seed}-${randomShortCode(4)}` : randomShortCode(7);
    if (!(await codeTaken(candidate))) return candidate;
  }
  // Last resort: long random (astronomically unlikely to collide).
  return randomShortCode(10);
}

export async function createCampaignLink(input: CampaignLinkInput): Promise<CampaignLink> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Database unavailable.");
  const name = input.name.trim();
  if (!name) throw new Error("A link name is required.");
  if (!isSafeDestination(input.destination_url)) throw new Error("Destination must be a namanias.com URL or a site path.");

  const short_code = await allocateShortCode(name, input.customAlias);
  const now = new Date().toISOString();
  const row = {
    short_code,
    destination_url: input.destination_url.trim(),
    destination_type: input.destination_type || "custom",
    destination_id: input.destination_id ?? null,
    name,
    description: input.description?.trim() || null,
    status: "active" as CampaignLinkStatus,
    source: slug(input.source),
    medium: slug(input.medium),
    platform: slug(input.platform),
    campaign: slug(input.campaign),
    campaign_id_external: input.campaign_id_external?.trim() || null,
    adset_name: input.adset_name?.trim() || null,
    adset_id_external: input.adset_id_external?.trim() || null,
    ad_name: input.ad_name?.trim() || null,
    ad_id_external: input.ad_id_external?.trim() || null,
    creative_name: input.creative_name?.trim() || null,
    content: slug(input.content),
    term: slug(input.term),
    placement: slug(input.placement),
    channel: slug(input.channel),
    tags: input.tags && input.tags.length ? input.tags : [],
    owner: input.owner ?? null,
    created_by: input.created_by ?? null,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await db.from(TABLE).insert(row).select("*").single();
  if (error || !data) throw new Error(error?.message || "Could not create link.");
  return rowToLink(data as Record<string, unknown>);
}

export async function listCampaignLinks(opts?: {
  status?: CampaignLinkStatus | "all";
  source?: string | null;
  destination_type?: DestinationType | null;
  search?: string | null;
  limit?: number;
}): Promise<CampaignLink[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  let q = db.from(TABLE).select("*").order("created_at", { ascending: false }).limit(opts?.limit ?? 500);
  if (opts?.status && opts.status !== "all") q = q.eq("status", opts.status);
  if (opts?.source) q = q.eq("source", slug(opts.source));
  if (opts?.destination_type) q = q.eq("destination_type", opts.destination_type);
  const { data } = await q;
  let rows = ((data as Record<string, unknown>[]) || []).map(rowToLink);
  const search = (opts?.search || "").trim().toLowerCase();
  if (search) {
    rows = rows.filter((l) =>
      [l.name, l.short_code, l.destination_url, l.campaign, l.ad_name, l.creative_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(search)),
    );
  }
  return rows;
}

export async function getCampaignLink(id: string): Promise<CampaignLink | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from(TABLE).select("*").eq("id", id).maybeSingle();
  return data ? rowToLink(data as Record<string, unknown>) : null;
}

/** Fast, minimal lookup for the public redirect. Case-insensitive on short_code. */
export async function resolveCampaignLinkByCode(
  code: string,
): Promise<Pick<
  CampaignLink,
  "id" | "short_code" | "destination_url" | "source" | "medium" | "campaign" | "content" | "term" | "status"
> | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const c = normalizeShortCode(code);
  if (!c) return null;
  const { data } = await db
    .from(TABLE)
    .select("id,short_code,destination_url,source,medium,campaign,content,term,status")
    .ilike("short_code", c)
    .limit(1)
    .maybeSingle();
  return (data as never) || null;
}

export async function updateCampaignLink(id: string, patch: Partial<CampaignLinkInput>): Promise<CampaignLink | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  if (patch.destination_url !== undefined && !isSafeDestination(patch.destination_url)) {
    throw new Error("Destination must be a namanias.com URL or a site path.");
  }
  const up: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const copy: (keyof CampaignLinkInput)[] = [
    "name", "description", "destination_url", "destination_type", "destination_id",
    "campaign_id_external", "adset_name", "adset_id_external", "ad_name", "ad_id_external",
    "creative_name", "placement", "owner", "tags",
  ];
  for (const k of copy) if (patch[k] !== undefined) up[k] = patch[k];
  const slugged: (keyof CampaignLinkInput)[] = ["source", "medium", "platform", "campaign", "content", "term", "channel"];
  for (const k of slugged) if (patch[k] !== undefined) up[k] = slug(patch[k] as string);
  const { data, error } = await db.from(TABLE).update(up).eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToLink(data as Record<string, unknown>) : null;
}

export async function setCampaignLinkStatus(id: string, status: CampaignLinkStatus): Promise<CampaignLink | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const up: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  up.archived_at = status === "archived" ? new Date().toISOString() : null;
  const { data } = await db.from(TABLE).update(up).eq("id", id).select("*").maybeSingle();
  return data ? rowToLink(data as Record<string, unknown>) : null;
}

/** Duplicate a link's metadata into a new link (fresh short code). */
export async function duplicateCampaignLink(id: string, overrides?: Partial<CampaignLinkInput>): Promise<CampaignLink> {
  const src = await getCampaignLink(id);
  if (!src) throw new Error("Link not found.");
  return createCampaignLink({
    name: overrides?.name || `${src.name} (copy)`,
    destination_url: overrides?.destination_url ?? src.destination_url,
    destination_type: overrides?.destination_type ?? src.destination_type,
    destination_id: overrides?.destination_id ?? src.destination_id,
    description: overrides?.description ?? src.description,
    customAlias: overrides?.customAlias ?? null,
    source: overrides?.source ?? src.source,
    medium: overrides?.medium ?? src.medium,
    platform: overrides?.platform ?? src.platform,
    campaign: overrides?.campaign ?? src.campaign,
    campaign_id_external: overrides?.campaign_id_external ?? src.campaign_id_external,
    adset_name: overrides?.adset_name ?? src.adset_name,
    adset_id_external: overrides?.adset_id_external ?? src.adset_id_external,
    ad_name: overrides?.ad_name ?? src.ad_name,
    ad_id_external: overrides?.ad_id_external ?? src.ad_id_external,
    creative_name: overrides?.creative_name ?? src.creative_name,
    content: overrides?.content ?? src.content,
    term: overrides?.term ?? src.term,
    placement: overrides?.placement ?? src.placement,
    channel: overrides?.channel ?? src.channel,
    tags: overrides?.tags ?? src.tags,
    owner: overrides?.owner ?? src.owner,
    created_by: overrides?.created_by ?? src.created_by,
  });
}

export interface ClickInput {
  campaign_link_id: string;
  short_code: string;
  destination_url: string;
  visitor_id?: string | null;
  session_id?: string | null;
  referrer?: string | null;
  user_agent?: string | null;
  device?: { type?: string; os?: string; browser?: string } | null;
  fbclid?: string | null;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  is_bot?: boolean;
}

/** Fire-and-forget click logger. NEVER throws — redirect reliability wins. */
export async function recordCampaignClick(input: ClickInput): Promise<void> {
  try {
    const db = getSupabaseAdmin();
    if (!db) return;
    await db.from(CLICKS).insert({
      campaign_link_id: input.campaign_link_id,
      short_code: input.short_code,
      destination_url: input.destination_url,
      visitor_id: input.visitor_id ?? null,
      session_id: input.session_id ?? null,
      referrer: input.referrer ?? null,
      user_agent: input.user_agent ?? null,
      device: input.device ?? null,
      fbclid: input.fbclid ?? null,
      gclid: input.gclid ?? null,
      wbraid: input.wbraid ?? null,
      gbraid: input.gbraid ?? null,
      is_bot: !!input.is_bot,
    });
  } catch {
    /* swallow — logging must never break the redirect */
  }
}
