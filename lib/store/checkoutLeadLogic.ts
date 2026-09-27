/**
 * Pure rules for Notes checkout leads. No database and no PII in analytics props.
 * A lead exists only after a valid Indian mobile is known. Cart-only browsing does not qualify.
 */

export const CHECKOUT_ABANDON_MS = 2 * 60 * 60 * 1000;
export const PAYMENT_ABANDON_MS = 6 * 60 * 60 * 1000;
export const LEAD_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export const CHECKOUT_STAGES = [
  "CONTACT_CAPTURED",
  "DETAILS_IN_PROGRESS",
  "PAYMENT_INITIATED",
  "CHECKOUT_ABANDONED",
  "PAYMENT_ABANDONED",
  "CONVERTED",
  "EXPIRED",
] as const;

export type CheckoutStage = (typeof CHECKOUT_STAGES)[number];

export const SALES_STATUSES = [
  "NEW",
  "CONTACTED",
  "FOLLOW_UP",
  "CONVERTED",
  "NOT_INTERESTED",
  "DO_NOT_CONTACT",
] as const;

export type SalesStatus = (typeof SALES_STATUSES)[number];

const OPEN_STAGES = new Set<CheckoutStage>([
  "CONTACT_CAPTURED",
  "DETAILS_IN_PROGRESS",
  "PAYMENT_INITIATED",
  "CHECKOUT_ABANDONED",
  "PAYMENT_ABANDONED",
]);

export interface LeadAddress {
  line1: string;
  city: string;
  state: string;
  pincode: string;
}

export interface LeadCartLine {
  product_id: string;
  sku: string;
  name: string;
  qty: number;
  line_total_paise: number;
}

export function normalizeIndianMobile(input: string | null | undefined): string | null {
  const digits = String(input || "").replace(/\D/g, "");
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return local;
}

export function maskPhone(phone: string | null | undefined): string {
  const local = normalizeIndianMobile(phone);
  if (!local) return "••••";
  return `••••${local.slice(-4)}`;
}

export function shouldCreateLead(phone: string | null | undefined, cartItemCount: number): boolean {
  return Boolean(normalizeIndianMobile(phone)) && cartItemCount > 0;
}

export function completeAddress(input: Partial<LeadAddress> | null | undefined): LeadAddress | null {
  if (!input) return null;
  const line1 = (input.line1 || "").trim();
  const city = (input.city || "").trim();
  const state = (input.state || "").trim();
  const pincode = (input.pincode || "").trim();
  if (!line1 || !city || !state || !/^[1-9][0-9]{5}$/.test(pincode)) return null;
  return { line1: line1.slice(0, 160), city: city.slice(0, 80), state: state.slice(0, 80), pincode };
}

export function stageForDraft(input: { name?: string | null; address?: LeadAddress | null }): CheckoutStage {
  if (input.address || (input.name || "").trim().length > 1) return "DETAILS_IN_PROGRESS";
  return "CONTACT_CAPTURED";
}

export function isOpenStage(stage: CheckoutStage): boolean {
  return OPEN_STAGES.has(stage);
}

export function nextAbandonedStage(
  stage: CheckoutStage,
  lastActivityAt: string | number | Date,
  now: Date,
): CheckoutStage | null {
  if (!isOpenStage(stage) || stage === "CHECKOUT_ABANDONED" || stage === "PAYMENT_ABANDONED") return null;
  const at = new Date(lastActivityAt).getTime();
  if (!Number.isFinite(at)) return null;
  const idle = now.getTime() - at;
  if (stage === "PAYMENT_INITIATED" && idle >= PAYMENT_ABANDON_MS) return "PAYMENT_ABANDONED";
  if ((stage === "CONTACT_CAPTURED" || stage === "DETAILS_IN_PROGRESS") && idle >= CHECKOUT_ABANDON_MS) return "CHECKOUT_ABANDONED";
  return null;
}

export function leadPriority(stage: CheckoutStage): "high" | "medium" | "low" {
  if (stage === "PAYMENT_INITIATED" || stage === "PAYMENT_ABANDONED") return "high";
  if (stage === "DETAILS_IN_PROGRESS") return "medium";
  return "low";
}

export function shouldRetainForPurge(input: {
  stage: CheckoutStage;
  salesStatus: SalesStatus;
  lastActivityAt: string;
  now: Date;
  hasOrder: boolean;
}): boolean {
  if (input.stage === "CONVERTED" || input.salesStatus === "DO_NOT_CONTACT" || input.hasOrder) return false;
  const at = new Date(input.lastActivityAt).getTime();
  return Number.isFinite(at) && input.now.getTime() - at >= LEAD_RETENTION_MS;
}

/** Analytics payloads for lead events. Phone, email, and address never belong here. */
export function leadAnalyticsProps(input: {
  leadId: string;
  stage: CheckoutStage;
  cartValuePaise: number;
  itemCount: number;
  channel: string;
  isTest: boolean;
  recovered?: boolean;
}): Record<string, unknown> {
  return {
    schema_version: 1,
    lead_id: input.leadId,
    stage: input.stage,
    cart_value_paise: input.cartValuePaise,
    item_count: input.itemCount,
    channel: input.channel,
    is_test: input.isTest,
    recovered: Boolean(input.recovered),
  };
}

export interface CheckoutLeadFact {
  created_at: string;
  converted_at: string | null;
  checkout_stage: CheckoutStage;
  was_abandoned: boolean;
  is_test: boolean;
  converted_value_paise: number | null;
  attribution_source: string;
}

export interface CheckoutLeadReport {
  leads: number;
  abandoned: number;
  recovered: number;
  paid: number;
  leadToPaidPct: number | null;
  recoveredRevenuePaise: number;
  sources: Array<{ source: string; leads: number; abandoned: number; recovered: number; paid: number; revenuePaise: number }>;
}

function inWindow(iso: string | null, start: Date, end: Date): boolean {
  if (!iso) return false;
  const at = new Date(iso).getTime();
  return at >= start.getTime() && at < end.getTime();
}

export function summarizeCheckoutLeads(rows: CheckoutLeadFact[], start: Date, end: Date): CheckoutLeadReport {
  const sources = new Map<string, { source: string; leads: number; abandoned: number; recovered: number; paid: number; revenuePaise: number }>();
  const bucket = (source: string) => {
    const row = sources.get(source) || { source, leads: 0, abandoned: 0, recovered: 0, paid: 0, revenuePaise: 0 };
    sources.set(source, row);
    return row;
  };
  let leads = 0;
  let abandoned = 0;
  let recovered = 0;
  let paid = 0;
  let recoveredRevenuePaise = 0;
  for (const row of rows) {
    if (row.is_test) continue;
    const source = row.attribution_source || "Unknown";
    const created = inWindow(row.created_at, start, end);
    const converted = row.checkout_stage === "CONVERTED" && inWindow(row.converted_at, start, end);
    if (created) {
      leads += 1;
      bucket(source).leads += 1;
      if (row.was_abandoned || row.checkout_stage === "CHECKOUT_ABANDONED" || row.checkout_stage === "PAYMENT_ABANDONED") {
        abandoned += 1;
        bucket(source).abandoned += 1;
      }
    }
    if (converted) {
      paid += 1;
      bucket(source).paid += 1;
      if (row.was_abandoned) {
        recovered += 1;
        const value = row.converted_value_paise || 0;
        recoveredRevenuePaise += value;
        bucket(source).recovered += 1;
        bucket(source).revenuePaise += value;
      }
    }
  }
  return {
    leads,
    abandoned,
    recovered,
    paid,
    leadToPaidPct: leads > 0 ? Math.round((paid / leads) * 1000) / 10 : null,
    recoveredRevenuePaise,
    sources: [...sources.values()].sort((a, b) => b.leads - a.leads),
  };
}

export function leadAllowsPromo(input: { marketingConsent: boolean; salesStatus: SalesStatus; stage: CheckoutStage }): boolean {
  if (!input.marketingConsent) return false;
  if (input.salesStatus === "DO_NOT_CONTACT" || input.salesStatus === "NOT_INTERESTED") return false;
  if (input.stage === "CONVERTED" || input.stage === "EXPIRED") return false;
  return true;
}
