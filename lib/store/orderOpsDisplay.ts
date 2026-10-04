/** Client-safe shapes and formatters for the admin orders operations summary. */
import { formatAdminWhen, fulfillmentLabel } from "./adminConsole";
import { formatPaise } from "./money";
import { PREMIUM_NOTICE_PAISE } from "./adminConsole";
import type { StageProgress } from "./opsBoard";

export type PackageDisplaySource = "BOOKED_SHIPMENT" | "ORDER_PACKAGE" | "PRODUCT_PROFILE";

export interface PackageDisplay {
  weight_grams: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  source: PackageDisplaySource;
}

export interface OrderOps {
  stage: StageProgress | null;
  city: string | null;
  state: string | null;
  courier: string | null;
  provider: string | null;
  rate_paise: number | null;
  courier_not_selected: boolean;
  pickup_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  latest_text: string | null;
  latest_at: string | null;
  package: PackageDisplay | null;
  issue: string | null;
  /** Saved courier comparisons for this order (summary only). Absent before history recording began. */
  quote_history?: { sessions: number; options: number; cheapest_paise: number | null; premium_paise: number | null } | null;
}

export interface ShippingRateStats {
  count: number;
  avg_paise: number | null;
  min_paise: number | null;
  max_paise: number | null;
  unknown: number;
}

export const PACKAGE_SOURCE_LABEL: Record<PackageDisplaySource, string> = {
  BOOKED_SHIPMENT: "Booked shipment",
  ORDER_PACKAGE: "Order package",
  PRODUCT_PROFILE: "Product profile",
};

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

export function formatPackageWeight(grams: number): string {
  return grams >= 1000 ? `${(grams / 1000).toFixed(1)} kg` : `${grams} g`;
}

export function formatPackageDims(pkg: Pick<PackageDisplay, "length_cm" | "width_cm" | "height_cm">): string {
  return `${trimNumber(pkg.length_cm)}×${trimNumber(pkg.width_cm)}×${trimNumber(pkg.height_cm)} cm`;
}

/** What staff do next for each `OrderOps.issue`. */
export const ISSUE_HINT: Record<string, string> = {
  "Package required": "Weigh and enter final parcel dimensions",
  "Courier city confirmation": "Confirm the courier's destination city",
  "Shipment needs attention": "Review the shipment address",
  "Pickup needs attention": "Pickup wasn't completed · review pickup",
  "Delivery exception": "Courier reported a delivery exception",
  "Return needs attention": "Return action required",
  "Refund pending": "Refund not yet completed",
  "Customer issue open": "Customer raised an issue",
  "Tracking needs attention": "No recent courier tracking update",
};

export interface OpsLines {
  headline: string;
  /** Courier rate beside a courier headline: a formatted amount or "Rate unavailable". */
  rate: string | null;
  detail: string | null;
  /** A timestamp in the lines came from Notes tracking sync. */
  recorded: boolean;
  alert: "package" | "issue" | null;
  /** Quiet comparison note, e.g. "4 options compared · cheapest ₹68.94". */
  quotes?: string | null;
}

/** Shown only once a courier is on the order; the cheapest is named only when the gap is material. */
export function quoteHistoryLine(ops: OrderOps | null | undefined): string | null {
  const q = ops?.quote_history;
  if (!q || !q.sessions || !ops?.courier) return null;
  const compared = `${q.options} ${q.options === 1 ? "option" : "options"} compared`;
  if (q.premium_paise != null && q.premium_paise >= PREMIUM_NOTICE_PAISE && q.cheapest_paise != null) return `${compared} · cheapest ${formatPaise(q.cheapest_paise)}`;
  return compared;
}

export interface OpsLinesInput {
  status: string;
  ops?: OrderOps | null;
}

/** Status-strip copy for one paid order. Reads only the shared read model; never guesses. */
export function opsLines(order: OpsLinesInput): OpsLines {
  const lines = baseOpsLines(order);
  const quotes = lines.alert ? null : quoteHistoryLine(order.ops);
  return quotes ? { ...lines, quotes } : lines;
}

function baseOpsLines(order: OpsLinesInput): OpsLines {
  const ops = order.ops;
  const stage = ops?.stage;
  const plain = (headline: string, detail: string | null = null, recorded = false): OpsLines => ({ headline, rate: null, detail, recorded, alert: null });
  if (!ops || !stage) return plain(fulfillmentLabel(order.status, false));
  if (ops.issue) {
    return {
      headline: ops.issue,
      rate: null,
      detail: ISSUE_HINT[ops.issue] || "Open details to resolve",
      recorded: false,
      alert: ops.issue === "Package required" ? "package" : "issue",
    };
  }
  const courier = ops.courier;
  const rate = courier ? (ops.rate_paise ? formatPaise(ops.rate_paise) : "Rate unavailable") : null;
  const withCourier = (detail: string | null, recorded = false): OpsLines => ({
    headline: courier || "Courier not recorded",
    rate,
    detail,
    recorded,
    alert: null,
  });
  switch (stage.key) {
    case "confirmed":
      return plain("Ready to prepare");
    case "preparing":
      return plain("Preparing notes");
    case "printing":
      return plain("Printing notes");
    case "packed":
      return courier ? withCourier(null) : plain("Courier not selected");
    case "pickup": {
      const at = formatAdminWhen(ops.pickup_at);
      return withCourier(at ? `Pickup ${at}` : "Pickup requested · time unavailable");
    }
    case "shipped": {
      const at = formatAdminWhen(ops.picked_up_at);
      return withCourier(at ? `Picked up ${at}` : null, Boolean(at));
    }
    case "transit":
    case "delivery": {
      const latestAt = formatAdminWhen(ops.latest_at);
      const pickedUp = formatAdminWhen(ops.picked_up_at);
      if (ops.latest_text) return withCourier(`${ops.latest_text}${latestAt ? ` · ${latestAt}` : ""}`, Boolean(latestAt));
      if (latestAt) return withCourier(`Updated ${latestAt}`, true);
      return withCourier(pickedUp ? `Picked up ${pickedUp}` : null, Boolean(pickedUp));
    }
    case "delivered": {
      const at = formatAdminWhen(ops.delivered_at);
      const via = courier ? `${courier}${ops.rate_paise ? ` · ${formatPaise(ops.rate_paise)}` : ""}` : null;
      return plain(at ? `Delivered ${at}` : "Delivered", via, Boolean(at));
    }
    default:
      return plain(stage.label);
  }
}
