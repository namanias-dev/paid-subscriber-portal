/**
 * Sales-over-time rows for one metric in Daily (per bucket) or Cumulative
 * (running total from the selected period start) mode. Pure, so the end-value
 * reconciliation with the KPI row is testable.
 */
import type { NotesPoint } from "./notesVisuals";
import type { FulfillmentPoint } from "./notesIntel";

/** Running total from the first bucket. Never decreases for non-negative input. */
export function cumulative(values: number[]): number[] {
  let running = 0;
  return values.map((value) => {
    running += value;
    return running;
  });
}

export type TimelineMetric = "orders" | "revenue" | "units" | "pickedUp" | "shipped" | "delivered";
export type TimelineMode = "daily" | "cumulative";

export interface TimelineRow {
  key: string;
  label: string;
  axis: string;
  /** Plotted value. Rupees for revenue, counts otherwise. */
  value: number;
  /** Paise for revenue, counts otherwise. Cumulative in cumulative mode. */
  valueRaw: number;
  /** This bucket alone, same units as valueRaw. */
  stepRaw: number;
  /** Sales bucket for the rich tooltip. */
  sales: NotesPoint | null;
}

function stepOf(point: NotesPoint, event: FulfillmentPoint | undefined, metric: TimelineMetric): number {
  if (metric === "revenue") return point.revenuePaise;
  if (metric === "units") return point.units;
  if (metric === "orders") return point.orders;
  return event ? event[metric] : 0;
}

export function timelineSeries(
  points: NotesPoint[],
  fulfillment: FulfillmentPoint[] | null,
  metric: TimelineMetric,
  mode: TimelineMode,
): TimelineRow[] {
  const events = new Map((fulfillment || []).map((point) => [point.key, point]));
  const steps = points.map((point) => stepOf(point, events.get(point.key), metric));
  const raw = mode === "cumulative" ? cumulative(steps) : steps;
  return points.map((point, index) => ({
    key: point.key,
    label: point.label,
    axis: point.axis,
    value: metric === "revenue" ? raw[index] / 100 : raw[index],
    valueRaw: raw[index],
    stepRaw: steps[index],
    sales: point,
  }));
}
