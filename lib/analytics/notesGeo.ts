/**
 * Client-safe helpers for the geography section: metric values and merging
 * rows for map outlines that carry more than one state or UT.
 */
import type { CityRow, StateRow } from "./notesIntel";

export type GeoMetric = "orders" | "revenue" | "units" | "shipping";

export const GEO_METRICS: Array<{ id: GeoMetric; label: string }> = [
  { id: "orders", label: "Orders" },
  { id: "revenue", label: "Revenue" },
  { id: "units", label: "Units" },
  { id: "shipping", label: "Avg shipping" },
];

export function geoMetricValue(row: Pick<StateRow, "orders" | "units" | "revenuePaise" | "avgPaise">, metric: GeoMetric): number | null {
  if (metric === "orders") return row.orders;
  if (metric === "units") return row.units;
  if (metric === "revenue") return row.revenuePaise;
  return row.avgPaise;
}

/** Highest first. Avg shipping ranks only rows that have a booked rate. */
export function rankGeo<T extends Pick<StateRow, "orders" | "units" | "revenuePaise" | "avgPaise">>(rows: T[], metric: GeoMetric): T[] {
  const list = metric === "shipping" ? rows.filter((row) => row.avgPaise != null) : rows;
  return [...list].sort((a, b) => (geoMetricValue(b, metric) ?? 0) - (geoMetricValue(a, metric) ?? 0) || b.orders - a.orders);
}

/** Sum counts; recombine rate stats from count-weighted averages and extremes. */
export function mergeStateRows(name: string, rows: StateRow[]): StateRow {
  if (rows.length === 1) return rows[0];
  const sum = (pick: (row: StateRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const count = sum((row) => row.count);
  const rated = rows.filter((row) => row.count > 0 && row.avgPaise != null);
  const subjects = new Map<string, number>();
  for (const row of rows) for (const item of row.subjectUnits) subjects.set(item.label, (subjects.get(item.label) || 0) + item.units);
  const orders = sum((row) => row.orders);
  const revenue = sum((row) => row.revenuePaise);
  const busiest = [...rows].sort((a, b) => b.shipments - a.shipments)[0];
  return {
    code: rows.map((row) => row.code).join("+"),
    name,
    orders,
    units: sum((row) => row.units),
    revenuePaise: revenue,
    aovPaise: orders ? Math.round(revenue / orders) : null,
    subjectUnits: [...subjects.entries()].map(([label, units]) => ({ label, units })).sort((a, b) => b.units - a.units),
    topCourier: busiest?.topCourier || null,
    anomalies: sum((row) => row.anomalies),
    avgWeightGrams: null,
    shipments: sum((row) => row.shipments),
    count,
    avgPaise: count ? Math.round(rated.reduce((total, row) => total + (row.avgPaise as number) * row.count, 0) / count) : null,
    medianPaise: null,
    minPaise: rated.length ? Math.min(...rated.map((row) => row.minPaise as number)) : null,
    maxPaise: rated.length ? Math.max(...rated.map((row) => row.maxPaise as number)) : null,
  };
}

export function citiesForState(cities: CityRow[], codes: string[]): CityRow[] {
  if (!codes.length) return cities;
  return cities.filter((row) => codes.includes(row.stateCode));
}
