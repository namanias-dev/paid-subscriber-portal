/**
 * Primary KPI tiles for Notes analytics. Pure: values come straight from the report
 * and the intelligence response; nothing is recalculated here.
 *
 * Avg booked shipping is `intel.shipping.avgPaise`, the same canonical figure the
 * Commerce & fulfillment booked-shipping detail shows (delivery shipments only;
 * Academy Pickup never enters it). No rate in range shows "—", never ₹0.
 */
import { formatPaise } from "@/lib/store/money";
import type { NotesAnalyticsView } from "@/lib/analytics/notesReport";
import type { NotesTrend } from "@/lib/analytics/notesVisuals";
import type { NotesIntel } from "@/lib/analytics/notesIntel";

export interface KpiTile {
  id: string;
  label: string;
  value: string;
  /** Accessible sentence, e.g. "Revenue ₹92,392". */
  ariaLabel: string;
  trend?: NotesTrend;
  note?: string;
  wide?: boolean;
}

function pct(value: number | null): string {
  return value == null ? "—" : `${value}%`;
}

export function avgBookedShipping(intel: Pick<NotesIntel, "shipping"> | null): { value: string; note: string } {
  if (!intel) return { value: "—", note: "Unavailable right now" };
  const ship = intel.shipping;
  if (ship.avgPaise == null || ship.count === 0) return { value: "—", note: "No booked rates" };
  return { value: formatPaise(ship.avgPaise), note: `Rate on ${ship.count} of ${ship.booked} booked` };
}

export function kpiTiles(report: Pick<NotesAnalyticsView, "kpis" | "visuals">, intel: Pick<NotesIntel, "shipping"> | null): KpiTile[] {
  const k = report.kpis;
  const trends = report.visuals?.trends;
  const shipping = avgBookedShipping(intel);
  const tiles: Array<Omit<KpiTile, "ariaLabel">> = [
    { id: "visitors", label: "Visitors", value: String(k.visitors), trend: trends?.visitors },
    { id: "productViewers", label: "Product viewers", value: String(k.productViewers), trend: trends?.productViewers },
    { id: "addToCarts", label: "Add to cart", value: String(k.addToCarts), trend: trends?.addToCarts },
    { id: "checkouts", label: "Checkout", value: String(k.checkouts), trend: trends?.checkouts },
    { id: "paidOrders", label: "Paid orders", value: String(k.paidOrders), trend: trends?.paidOrders },
    { id: "conversion", label: "Conversion", value: pct(k.conversionPct), trend: trends?.conversion },
    { id: "revenue", label: "Revenue", value: formatPaise(k.revenuePaise), trend: trends?.revenue },
    { id: "aov", label: "AOV", value: k.aovPaise == null ? "—" : formatPaise(k.aovPaise), trend: trends?.aov },
    { id: "avgShipping", label: "Avg booked shipping", value: shipping.value, note: shipping.note, wide: true },
  ];
  return tiles.map((tile) => ({ ...tile, ariaLabel: `${tile.label} ${tile.value === "—" ? "not available" : tile.value}` }));
}
