import { istYMD } from "./dates";
import { isPaidStatus as isPaid, itemKey } from "./paymentsAgg";
import type { Payment } from "./types";

/** Presentation for each normalized source; unmapped values fall back to a
 * neutral title-cased label so a new source never breaks the card. */
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

/**
 * Paid webinar registrations broken down by acquisition SOURCE. Same paid-only +
 * distinct methodology as the trend/split cards: one registration = distinct
 * (phone, webinar, IST day). Each registration's source is its stamped
 * `attribution_source` (first non-empty among that day's rows); registrations
 * with none fall into an explicit "unknown" bucket (never inferred). Buckets
 * therefore always sum to the paid total for the selection. Read-only.
 *
 * `selected` scopes to one webinar (itemKey); "" = all. `inSel` is an IST-YMD
 * predicate (timeframe window).
 */
export function bucketizeSources(payments: Payment[], selected: string, inSel: (ymd: string) => boolean): SourceBreakdown {
  const regs = new Map<string, string>(); // (phone|webinar|day) -> source
  for (const p of payments) {
    if (!isPaid(p.status) || p.item_type !== "webinar") continue;
    const key = itemKey(p);
    if (selected && key !== selected) continue;
    const ymd = istYMD(p.created_at);
    if (!ymd || !inSel(ymd)) continue;
    const rk = `${(p.phone || "").trim()}|${key}|${ymd}`;
    const src = normSource(p.attribution_source) || "unknown";
    const cur = regs.get(rk);
    if (cur === undefined) regs.set(rk, src);
    else if (cur === "unknown" && src !== "unknown") regs.set(rk, src);
  }
  const bySource = new Map<string, number>();
  for (const s of regs.values()) bySource.set(s, (bySource.get(s) || 0) + 1);
  const rows = [...bySource.entries()]
    .map(([key, count]) => ({ key, count }))
    // Known sources first (by count), Unknown always last for clarity.
    .sort((a, b) => {
      if ((a.key === "unknown") !== (b.key === "unknown")) return a.key === "unknown" ? 1 : -1;
      return b.count - a.count || sourceMeta(a.key).label.localeCompare(sourceMeta(b.key).label);
    });
  return { rows, total: regs.size };
}
