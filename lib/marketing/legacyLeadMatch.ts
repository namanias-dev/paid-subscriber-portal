/**
 * Read-time legacy-lead match (campaign + status) by normalised phone_key.
 *
 * NEVER called from payment / registration write paths. Surfaces batch-lookup
 * the CURRENT PAGE of phones only — one set-based query, no N+1.
 *
 * Matching is against `leads` rows where `is_legacy = true`. The existing
 * SourcePill / current source values are never mutated.
 */
import { getSupabaseAdmin } from "../supabase";
import { normPhone } from "../phone";

export interface LegacyLeadMatch {
  leadId: string;
  phoneKey: string;
  /** Prefer campaign_clean → campaign → legacy_source_tab. */
  campaign: string;
  status: string;
  /** Sheet / import tab — historical source bucket (for tooltip + reports). */
  sourceTab: string | null;
  /** ISO date of the legacy record (first_seen_at || created_at). */
  date: string | null;
  /** Additional legacy rows on this phone beyond the one shown. */
  extraCount: number;
}

type LegacyRow = {
  id: string;
  phone_key: string | null;
  campaign_clean: string | null;
  campaign: string | null;
  status: string | null;
  legacy_source_tab: string | null;
  first_seen_at: string | null;
  created_at: string | null;
};

function nn(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

export function phoneKeyFromRaw(raw: string | null | undefined): string {
  const k = normPhone(raw) || "";
  // Indian mobile: 10 digits starting 6–9. Rejects staff:uuid digit residue.
  if (k.length !== 10 || !/^[6-9]/.test(k)) return "";
  return k;
}

export function pickLegacyCampaign(row: {
  campaign_clean?: string | null;
  campaign?: string | null;
  legacy_source_tab?: string | null;
}): string {
  return nn(row.campaign_clean) || nn(row.campaign) || nn(row.legacy_source_tab) || "Unknown campaign";
}

/** Short date for the pill — historical framing, not a due date. */
export function formatLegacyDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

/**
 * Pill label. Explicitly historical — staff must not treat status as current.
 * Example: `Legacy: INDIA-NCERT Batch · Not Interested · 12 Jan 2024`
 */
export function formatLegacyPillLabel(m: LegacyLeadMatch): string {
  const date = formatLegacyDate(m.date);
  const extra = m.extraCount > 0 ? ` (+${m.extraCount})` : "";
  return `Legacy: ${m.campaign} · ${m.status}${date ? ` · ${date}` : ""}${extra}`;
}

export function legacyWorklistHref(phoneKey: string): string {
  const q = new URLSearchParams({
    scope: "legacy",
    search: phoneKey,
  });
  return `/admin/leads/worklist?${q.toString()}`;
}

function rowToMatch(row: LegacyRow, extraCount: number): LegacyLeadMatch {
  return {
    leadId: row.id,
    phoneKey: row.phone_key || "",
    campaign: pickLegacyCampaign(row),
    status: nn(row.status) || "—",
    sourceTab: nn(row.legacy_source_tab),
    date: row.first_seen_at || row.created_at || null,
    extraCount,
  };
}

/**
 * Batch lookup: one query for the whole page of phones.
 * Returns a map keyed by phone_key (10 digits). Missing keys = no pill.
 */
export async function lookupLegacyLeadsByPhones(
  phones: readonly (string | null | undefined)[],
): Promise<Record<string, LegacyLeadMatch>> {
  const keys = [...new Set(phones.map(phoneKeyFromRaw).filter(Boolean))];
  if (!keys.length) return {};

  const db = getSupabaseAdmin();
  if (!db) return {};

  // Cap defensive — surfaces should only pass the current page.
  const capped = keys.slice(0, 500);

  const { data, error } = await db
    .from("leads")
    .select("id, phone_key, campaign_clean, campaign, status, legacy_source_tab, first_seen_at, created_at")
    .eq("is_legacy", true)
    .is("merged_into", null)
    .in("phone_key", capped)
    .order("first_seen_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false });

  if (error) {
    console.error("[legacyLeadMatch] lookup failed:", error.message);
    return {};
  }

  const rows = (data || []) as LegacyRow[];
  const byKey = new Map<string, LegacyRow[]>();
  for (const r of rows) {
    const k = (r.phone_key || "").trim();
    if (k.length !== 10) continue;
    const list = byKey.get(k);
    if (list) list.push(r);
    else byKey.set(k, [r]);
  }

  const out: Record<string, LegacyLeadMatch> = {};
  for (const [k, list] of byKey) {
    // Already ordered by first_seen_at/created_at desc from the query;
    // re-sort defensively for stable most-recent pick.
    list.sort((a, b) => {
      const ta = new Date(a.first_seen_at || a.created_at || 0).getTime();
      const tb = new Date(b.first_seen_at || b.created_at || 0).getTime();
      return tb - ta;
    });
    out[k] = rowToMatch(list[0], Math.max(0, list.length - 1));
  }
  return out;
}

/** Client helper — same last-10 key as the server. */
export function lookupLegacyMatch(
  byPhone: Record<string, LegacyLeadMatch> | null | undefined,
  phone: string | null | undefined,
): LegacyLeadMatch | null {
  if (!byPhone) return null;
  const key = phoneKeyFromRaw(phone);
  if (!key) return null;
  return byPhone[key] || null;
}
