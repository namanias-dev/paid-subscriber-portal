/**
 * Pure funnel math for Campaign Links. No database. The rollup reader sums
 * stored daily rows, then this module shapes them into a destination-specific
 * funnel so a Notes link does not lead with webinar registrations.
 */

export type FunnelKind = "notes" | "webinar" | "course" | "general";

export interface FunnelStep {
  label: string;
  value: number;
}

export interface RollupTotals {
  clicks: number;
  visitors: number;
  productViews: number;
  addToCartUsers: number;
  addToCartEvents: number;
  checkoutUsers: number;
  registrations: number;
  leads: number;
  ordersCreated: number;
  paidOrders: number;
  units: number;
  revenuePaise: number;
  paidAdmissions: number;
  paidWebinars: number;
  admissionsRevenue: number;
}

export function funnelKind(destinationType: string | null | undefined, destinationUrl?: string | null): FunnelKind {
  const type = (destinationType || "").toLowerCase();
  const url = (destinationUrl || "").toLowerCase();
  if (type === "notes" || url.includes("/notes")) return "notes";
  if (type === "webinar" || url.includes("webinar")) return "webinar";
  if (type === "course" || url.includes("/courses") || url.includes("/course")) return "course";
  return "general";
}

/** First-touch clid wins. A later direct visit (empty clid) does not erase it. */
export function campaignCode(firstClid?: string | null, lastClid?: string | null): string | null {
  const code = (firstClid || lastClid || "").trim().toLowerCase();
  return code || null;
}

export function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}

export function aov(revenue: number, paidOrders: number): number | null {
  return paidOrders > 0 ? Math.round(revenue / paidOrders) : null;
}

export function funnelSteps(kind: FunnelKind, m: RollupTotals): FunnelStep[] {
  if (kind === "notes") {
    return [
      { label: "Visitors", value: m.visitors },
      { label: "Product views", value: m.productViews },
      { label: "Added to cart", value: m.addToCartUsers },
      { label: "Checkout started", value: m.checkoutUsers },
      { label: "Paid orders", value: m.paidOrders },
    ];
  }
  if (kind === "webinar") {
    return [
      { label: "Visitors", value: m.visitors },
      { label: "Registrations", value: m.registrations },
      { label: "Leads", value: m.leads },
      { label: "Paid admissions", value: m.paidAdmissions + m.paidWebinars },
    ];
  }
  if (kind === "course") {
    return [
      { label: "Visitors", value: m.visitors },
      { label: "Leads", value: m.leads },
      { label: "Paid admissions", value: m.paidAdmissions },
    ];
  }
  return [
    { label: "Visitors", value: m.visitors },
    { label: "Leads", value: m.leads },
    { label: "Paid orders", value: m.paidOrders },
  ];
}

/** Collapse identical paid retries. Distinct purchases stay. */
export function dedupePaidKeys(rows: { key: string; amount: number; at: number }[]): { count: number; revenue: number } {
  const seen = new Map<string, { amount: number; at: number }>();
  for (const row of rows) {
    const prev = seen.get(row.key);
    if (!prev || row.at < prev.at) seen.set(row.key, { amount: row.amount, at: row.at });
  }
  let revenue = 0;
  for (const row of seen.values()) revenue += row.amount;
  return { count: seen.size, revenue };
}

export function sumDaily(rows: RollupTotals[]): RollupTotals {
  const out: RollupTotals = {
    clicks: 0, visitors: 0, productViews: 0, addToCartUsers: 0, addToCartEvents: 0,
    checkoutUsers: 0, registrations: 0, leads: 0, ordersCreated: 0, paidOrders: 0,
    units: 0, revenuePaise: 0, paidAdmissions: 0, paidWebinars: 0, admissionsRevenue: 0,
  };
  for (const row of rows) {
    out.clicks += row.clicks;
    out.visitors += row.visitors;
    out.productViews += row.productViews;
    out.addToCartUsers += row.addToCartUsers;
    out.addToCartEvents += row.addToCartEvents;
    out.checkoutUsers += row.checkoutUsers;
    out.registrations += row.registrations;
    out.leads += row.leads;
    out.ordersCreated += row.ordersCreated;
    out.paidOrders += row.paidOrders;
    out.units += row.units;
    out.revenuePaise += row.revenuePaise;
    out.paidAdmissions += row.paidAdmissions;
    out.paidWebinars += row.paidWebinars;
    out.admissionsRevenue += row.admissionsRevenue;
  }
  return out;
}
