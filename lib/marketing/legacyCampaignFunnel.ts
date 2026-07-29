/**
 * Legacy campaign → course conversion funnel (read-only).
 *
 * Universe: students whose phone_key matches a legacy lead (same pipeline as
 * LegacyLeadPill — last-10 phone_key, most-recent legacy campaign).
 *
 * Stages (CUMULATIVE nested course path — see module docs in the card):
 *   matched ≥ seat_booked ≥ installment_paid
 *
 * Webinar registration is reported as a SIDE metric: among matched students it
 * is largely disjoint from seat booking, so it is NOT used as a nest gate.
 */

export const NO_CAMPAIGN_LABEL = "No campaign recorded";

/** Campaigns with matched < this get a low-sample flag (rates are noisy). */
export const LOW_SAMPLE_THRESHOLD = 5;

/** Long-tail campaigns beyond this rank collapse into "Other". */
export const TOP_CAMPAIGNS_PREVIEW = 8;

export type FunnelSort = "paid" | "matched" | "seat_rate" | "paid_rate";

export interface LegacyCampaignFunnelRow {
  campaign: string;
  /** Display label (blank → No campaign recorded). */
  label: string;
  matched: number;
  webinarReg: number;
  /** Cumulative: reached seat or beyond. */
  seatCum: number;
  /** Cumulative: reached installment paid. */
  paidCum: number;
  /** Exclusive: matched, no seat. */
  exclNoSeat: number;
  /** Exclusive: seat booked, no installment paid. */
  exclSeatOnly: number;
  /** Exclusive: installment paid. */
  exclPaid: number;
  /** seatCum / matched */
  seatRate: number | null;
  /** paidCum / seatCum */
  paidGivenSeatRate: number | null;
  /** paidCum / matched */
  paidRate: number | null;
  lowSample: boolean;
}

export interface LegacyCampaignFunnelResult {
  rows: LegacyCampaignFunnelRow[];
  totals: LegacyCampaignFunnelRow;
  generatedAt: string;
  queryMs: number | null;
}

type RawRpcRow = {
  campaign: string | null;
  matched: number | string;
  webinar_reg: number | string;
  seat_cum: number | string;
  paid_cum: number | string;
  excl_no_seat: number | string;
  excl_seat_only: number | string;
  excl_paid: number | string;
};

function n(v: number | string | null | undefined): number {
  const x = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function rate(num: number, den: number): number | null {
  if (den <= 0) return null;
  return num / den;
}

export function campaignLabel(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  return s ? s : NO_CAMPAIGN_LABEL;
}

export function enrichFunnelRow(raw: {
  campaign: string;
  matched: number;
  webinarReg: number;
  seatCum: number;
  paidCum: number;
  exclNoSeat: number;
  exclSeatOnly: number;
  exclPaid: number;
}): LegacyCampaignFunnelRow {
  const matched = raw.matched;
  return {
    ...raw,
    label: campaignLabel(raw.campaign),
    seatRate: rate(raw.seatCum, matched),
    paidGivenSeatRate: rate(raw.paidCum, raw.seatCum),
    paidRate: rate(raw.paidCum, matched),
    lowSample: matched > 0 && matched < LOW_SAMPLE_THRESHOLD,
  };
}

/** Exclusive tiers must sum to matched — used in tests + API assert. */
export function exclusiveSum(row: Pick<LegacyCampaignFunnelRow, "exclNoSeat" | "exclSeatOnly" | "exclPaid">): number {
  return row.exclNoSeat + row.exclSeatOnly + row.exclPaid;
}

export function assertFunnelReconciles(row: LegacyCampaignFunnelRow): boolean {
  return (
    exclusiveSum(row) === row.matched &&
    row.seatCum === row.exclSeatOnly + row.exclPaid &&
    row.paidCum === row.exclPaid &&
    row.seatCum <= row.matched &&
    row.paidCum <= row.seatCum
  );
}

export function mapRpcRows(raw: RawRpcRow[]): LegacyCampaignFunnelRow[] {
  return raw.map((r) =>
    enrichFunnelRow({
      campaign: r.campaign ?? "",
      matched: n(r.matched),
      webinarReg: n(r.webinar_reg),
      seatCum: n(r.seat_cum),
      paidCum: n(r.paid_cum),
      exclNoSeat: n(r.excl_no_seat),
      exclSeatOnly: n(r.excl_seat_only),
      exclPaid: n(r.excl_paid),
    }),
  );
}

export function sumFunnelRows(rows: LegacyCampaignFunnelRow[]): LegacyCampaignFunnelRow {
  const acc = {
    campaign: "__total__",
    matched: 0,
    webinarReg: 0,
    seatCum: 0,
    paidCum: 0,
    exclNoSeat: 0,
    exclSeatOnly: 0,
    exclPaid: 0,
  };
  for (const r of rows) {
    acc.matched += r.matched;
    acc.webinarReg += r.webinarReg;
    acc.seatCum += r.seatCum;
    acc.paidCum += r.paidCum;
    acc.exclNoSeat += r.exclNoSeat;
    acc.exclSeatOnly += r.exclSeatOnly;
    acc.exclPaid += r.exclPaid;
  }
  const totals = enrichFunnelRow(acc);
  return { ...totals, label: "All matched students", lowSample: false };
}

export function sortFunnelRows(rows: LegacyCampaignFunnelRow[], sort: FunnelSort): LegacyCampaignFunnelRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    switch (sort) {
      case "matched":
        return b.matched - a.matched || b.paidCum - a.paidCum;
      case "seat_rate":
        return (b.seatRate ?? -1) - (a.seatRate ?? -1) || b.matched - a.matched;
      case "paid_rate":
        return (b.paidRate ?? -1) - (a.paidRate ?? -1) || b.matched - a.matched;
      case "paid":
      default:
        return b.paidCum - a.paidCum || b.matched - a.matched;
    }
  });
  return copy;
}

/**
 * Collapse long tail into Other. Totals of Other use summed exclusive tiers
 * so reconciliation still holds.
 */
export function collapseLongTail(
  rows: LegacyCampaignFunnelRow[],
  topN = TOP_CAMPAIGNS_PREVIEW,
): { head: LegacyCampaignFunnelRow[]; other: LegacyCampaignFunnelRow | null; hidden: LegacyCampaignFunnelRow[] } {
  if (rows.length <= topN) return { head: rows, other: null, hidden: [] };
  const head = rows.slice(0, topN);
  const hidden = rows.slice(topN);
  const other = sumFunnelRows(hidden);
  return {
    head,
    other: {
      ...other,
      campaign: "__other__",
      label: `Other (${hidden.length} campaigns)`,
      lowSample: false,
    },
    hidden,
  };
}

export function formatPct(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}

export function legacyWorklistCampaignHref(campaign: string): string {
  const q = new URLSearchParams({
    scope: "legacy",
    search: campaign.trim() || NO_CAMPAIGN_LABEL,
  });
  return `/admin/leads/worklist?${q.toString()}`;
}
