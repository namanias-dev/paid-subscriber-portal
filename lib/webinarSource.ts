import { istYMD } from "./dates";
import { isPaidStatus as isPaid, itemKey } from "./paymentsAgg";
import type { Payment } from "./types";
import { sourceDefinition, UNKNOWN_SOURCE, type SourceDisplayKey } from "./marketing/sourceDefinitions";

/** Presentation for each normalized RAW source (legacy flat `attribution_source`
 * bucket keys). Kept for backward compatibility with the pre-v2 breakdown; the
 * v2 breakdown routes through {@link sourceDefinition} which speaks the derived
 * channel vocabulary (`"Google Ads"`, `"Meta Ads"`, …). Unmapped values fall
 * back to a neutral title-cased label so a new source never breaks the card. */
export const SOURCE_META: Record<string, { label: string; color: string }> = {
  instagram: { label: "Instagram", color: "#E1306C" },
  facebook: { label: "Facebook", color: "#1877F2" },
  whatsapp: { label: "WhatsApp", color: "#25D366" },
  google: { label: "Google", color: "#EA4335" },
  youtube: { label: "YouTube", color: "#FF0000" },
  telegram: { label: "Telegram", color: "#229ED9" },
  direct: { label: "Direct", color: "#0057FF" },
  referral: { label: "Referral", color: "#8B5CF6" },
  other: { label: "Other", color: "#64748b" },
  unknown: { label: "Unknown", color: "#94a3b8" },
};

export function sourceMeta(key: string) {
  return SOURCE_META[key] || { label: key.charAt(0).toUpperCase() + key.slice(1), color: "#64748b" };
}

export const normSource = (s: string | null | undefined) => (s || "").trim().toLowerCase();

export interface SourceRow {
  key: string;
  count: number;
}
export interface SourceBreakdown {
  rows: SourceRow[];
  total: number;
}

/** Loose last-10 digits so a "+91..." payment phone matches a raw-10 lead-record
 * phone (same convention `SourcePill.lastDigits10` uses). Duplicated here to
 * keep this file client-safe with zero react imports. */
function last10(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).replace(/\D/g, "").slice(-10);
}

/** Minimal shape of the attribution stamp the admin payments API attaches per
 * normalized phone. Structural match with `SourcePill.LeadAttrStamp` — kept
 * decoupled to avoid pulling a React component into a pure lib.
 *
 * `legacy` (optional): true when the underlying lead is a legacy-imported row
 * (`attribution.legacy === true`). Set by the admin payments/students routes so
 * the aggregate source card / channel counts stay legacy-free even when the
 * per-phone map includes legacy leads for DISPLAY purposes. See G1 in
 * `docs/naman-ai/reports/payment-source-restore.md`: "display source ≠
 * include-legacy-in-counts". Undefined means "not-legacy" (unchanged behavior).
 */
export interface DerivedChannelAttr {
  channel: string | null;
  legacy?: boolean;
}

/**
 * Paid webinar registrations broken down by acquisition SOURCE. Same paid-only +
 * distinct methodology as the trend/split cards: one registration = distinct
 * (phone, webinar, IST day).
 *
 * TWO source vocabularies are supported and controlled by `leadAttrByPhone`:
 *  - When OMITTED (legacy): each registration's source is its stamped flat
 *    `payments.attribution_source` (first non-empty among that day's rows).
 *    Registrations with none fall into an explicit "unknown" bucket. This is
 *    the pre-v2 behavior — kept EXACTLY intact so a `PAYMENTS_UI_V2=false`
 *    rollback restores byte-identical bucketing.
 *  - When PROVIDED: each registration's source is the DERIVED CRM channel
 *    resolved from the matching lead's `deriveChannel` output (looked up by
 *    normalized last-10-digit phone). This mirrors the Lead CRM's channel pill
 *    exactly, so a paid Meta ad (fbclid, no utm_source) that flat-stamped
 *    "direct" is now correctly attributed "Meta Ads". No lead match →
 *    honestly "Unknown". Never fabricates a source.
 *
 * Buckets always sum to the paid distinct-registration total for the selection.
 * Read-only; no DB writes anywhere in this file.
 */
export function bucketizeSources(
  payments: Payment[],
  selected: string,
  inSel: (ymd: string) => boolean,
  leadAttrByPhone?: Record<string, DerivedChannelAttr> | null,
): SourceBreakdown {
  const useDerived = !!leadAttrByPhone;
  const regs = new Map<string, string>();
  for (const p of payments) {
    if (!isPaid(p.status) || p.item_type !== "webinar") continue;
    const key = itemKey(p);
    if (selected && key !== selected) continue;
    const ymd = istYMD(p.created_at);
    if (!ymd || !inSel(ymd)) continue;
    const rk = `${(p.phone || "").trim()}|${key}|${ymd}`;
    const src = useDerived
      ? derivedChannelFor(p, leadAttrByPhone)
      : (normSource(p.attribution_source) || "unknown");
    const cur = regs.get(rk);
    // First non-"unknown"/non-"Unknown" wins for the day; both vocabularies
    // agree on the string comparison since neither uses the same casing twice.
    const isUnknownSrc = src === "unknown" || src === UNKNOWN_SOURCE;
    if (cur === undefined) regs.set(rk, src);
    else if ((cur === "unknown" || cur === UNKNOWN_SOURCE) && !isUnknownSrc) regs.set(rk, src);
  }
  const bySource = new Map<string, number>();
  for (const s of regs.values()) bySource.set(s, (bySource.get(s) || 0) + 1);
  const rows = [...bySource.entries()]
    .map(([key, count]) => ({ key, count }))
    // Known sources first (by count), Unknown always last for clarity.
    .sort((a, b) => {
      const aUnk = a.key === "unknown" || a.key === UNKNOWN_SOURCE;
      const bUnk = b.key === "unknown" || b.key === UNKNOWN_SOURCE;
      if (aUnk !== bUnk) return aUnk ? 1 : -1;
      const aLabel = useDerived ? sourceDefinition(a.key).label : sourceMeta(a.key).label;
      const bLabel = useDerived ? sourceDefinition(b.key).label : sourceMeta(b.key).label;
      return b.count - a.count || aLabel.localeCompare(bLabel);
    });
  return { rows, total: regs.size };
}

/**
 * Resolve the DERIVED CRM channel for a single payment. Looks up the matching
 * lead by normalized last-10 phone and returns the same string
 * `deriveChannel(touch)` produces (`"Google Ads"`, `"Meta Ads"`, `"Organic"`,
 * `"Referral"`, `"Direct"`, `"Other"`) — or `"Unknown"` when no lead exists
 * for that phone. NEVER fabricates a channel: empty/missing lead-side channel
 * returns `"Unknown"`.
 */
export function derivedChannelFor(
  payment: Payment,
  byPhone: Record<string, DerivedChannelAttr> | null | undefined,
): SourceDisplayKey {
  if (!byPhone) return UNKNOWN_SOURCE;
  const key = last10(payment.phone);
  if (!key) return UNKNOWN_SOURCE;
  const attr = byPhone[key];
  // Legacy leads are DISPLAYED (SourcePill can render `attr.channel` directly)
  // but never counted in the aggregate source card / channel totals — that
  // would silently re-pollute analytics with the ~178k backfilled phones and
  // break G1. Legacy rows bucket into "Unknown" here, identical to their
  // pre-shipment behavior when `applyLegacyFilter` hid them from the map
  // entirely. See tests/lead-migration/legacy-isolation.test.ts.
  if (attr?.legacy === true) return UNKNOWN_SOURCE;
  const ch = (attr?.channel || "").trim();
  if (!ch) return UNKNOWN_SOURCE;
  // Trust the stored channel string as-is: it was produced by `deriveChannel`
  // and is one of `MARKETING_CHANNELS` in modern rows. Unknown legacy strings
  // gracefully fall through the definition lookup at render time.
  return ch as SourceDisplayKey;
}

/**
 * Resolve the display metadata for a bucket key produced by
 * {@link bucketizeSources}. When derived-channel bucketization was used, keys
 * are `"Google Ads"`/`"Meta Ads"`/etc. and metadata comes from the shared
 * {@link sourceDefinition}. Legacy keys still resolve via {@link sourceMeta}.
 */
export function bucketMeta(key: string, useDerived: boolean): { label: string; color: string } {
  if (useDerived) {
    const def = sourceDefinition(key);
    return { label: def.label, color: def.color };
  }
  return sourceMeta(key);
}
