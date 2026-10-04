"use client";

import { Component, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { CityRow, StateRow } from "@/lib/analytics/notesIntel";
import { GEO_METRICS, citiesForState, geoMetricValue, rankGeo, type GeoMetric } from "@/lib/analytics/notesGeo";
import { SHAPE_STATES, shapeLabel } from "@/lib/analytics/indiaStates";
import { formatPaise } from "@/lib/store/money";
import CityRanking from "./CityRanking";

const IndiaMap = dynamic(() => import("./IndiaMap"), {
  ssr: false,
  loading: () => <div className="mx-auto aspect-[612/696] w-full max-w-[460px] animate-pulse rounded-2xl bg-ca-navy/[0.04]" />,
});

class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <p className="py-10 text-center text-sm text-ca-navy/55">The map is unavailable right now. The state ranking shows the same numbers.</p>;
    return this.props.children;
  }
}

function metricText(row: StateRow, metric: GeoMetric): string {
  const value = geoMetricValue(row, metric);
  if (value == null) return "—";
  if (metric === "revenue" || metric === "shipping") return formatPaise(value);
  if (metric === "orders") return `${value} ${value === 1 ? "order" : "orders"}`;
  return `${value} ${value === 1 ? "unit" : "units"}`;
}

type SortKey = "name" | "orders" | "units" | "revenuePaise" | "aovPaise" | "count" | "avgPaise" | "medianPaise" | "minPaise" | "maxPaise" | "anomalies";

const COLUMNS: Array<{ key: SortKey; label: string; money?: boolean; wide?: boolean }> = [
  { key: "orders", label: "Orders" },
  { key: "units", label: "Units", wide: true },
  { key: "revenuePaise", label: "Revenue", money: true },
  { key: "aovPaise", label: "AOV", money: true, wide: true },
  { key: "count", label: "With rate", wide: true },
  { key: "avgPaise", label: "Avg ship", money: true },
  { key: "medianPaise", label: "Median", money: true, wide: true },
  { key: "minPaise", label: "Min", money: true, wide: true },
  { key: "maxPaise", label: "Max", money: true, wide: true },
  { key: "anomalies", label: "Anomalies", wide: true },
];

export default function GeoIntel({ states, cities }: { states: StateRow[] | null; cities: CityRow[] | null }) {
  const reduce = useReducedMotion();
  const [metric, setMetric] = useState<GeoMetric>("orders");
  const [selected, setSelected] = useState<{ codes: string[]; label: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "orders", desc: true });
  const ranked = useMemo(() => rankGeo(states || [], metric), [states, metric]);
  const selectedRows = useMemo(() => (states || []).filter((row) => selected?.codes.includes(row.code)), [states, selected]);
  const detail = selectedRows.length === 1 ? selectedRows[0] : null;
  const scopedCities = useMemo(() => citiesForState(cities || [], selected?.codes || []), [cities, selected]);
  const unknown = (states || []).find((row) => row.code === "unknown");
  const max = Math.max(1, ...ranked.map((row) => geoMetricValue(row, metric) ?? 0));
  const sortedTable = useMemo(() => {
    const list = [...(states || [])];
    return list.sort((a, b) => {
      if (sort.key === "name") return sort.desc ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
      const av = (a[sort.key] as number | null) ?? -1;
      const bv = (b[sort.key] as number | null) ?? -1;
      return sort.desc ? bv - av : av - bv;
    });
  }, [states, sort]);

  const selectShape = (shapeId: string | null) => {
    if (!shapeId) return setSelected(null);
    const codes = (SHAPE_STATES[shapeId] || []).filter((code) => (states || []).some((row) => row.code === code));
    setSelected(codes.length ? { codes, label: shapeLabel(shapeId) } : null);
  };
  const selectState = (row: StateRow) => {
    setSelected((current) => (current && current.codes.length === 1 && current.codes[0] === row.code ? null : { codes: [row.code], label: row.name }));
  };

  return (
    <section className="mt-4 rounded-2xl bg-white p-4" aria-labelledby="notes-geo-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="notes-geo-heading" className="font-heading text-lg font-bold text-[var(--ca-navy)]">Geographic intelligence</h2>
          <p className="mt-1 text-sm text-ca-navy/55">Orders paid in range, by delivery state. Selecting a state only changes this section.</p>
        </div>
        <div className="-mx-1 max-w-full overflow-x-auto px-1">
          <div className="flex w-max rounded-full bg-ca-navy/5 p-1" role="tablist" aria-label="Geography metric">
            {GEO_METRICS.map((item) => {
              const active = metric === item.id;
              return (
                <button key={item.id} type="button" role="tab" aria-selected={active} onClick={() => setMetric(item.id)} className={`min-h-9 whitespace-nowrap rounded-full px-3 text-xs font-semibold ${active ? "bg-[var(--ca-navy)] text-white" : "text-ca-navy/70"}`}>
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {states == null ? (
        <p className="mt-3 text-sm text-ca-navy/55">Geographic analytics are unavailable right now.</p>
      ) : states.length === 0 ? (
        <p className="mt-3 text-sm text-ca-navy/55">No paid orders in this period.</p>
      ) : (
        <>
          <div className="mt-4 grid gap-5 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-7">
              <MapBoundary>
                <IndiaMap states={states} metric={metric} selectedCodes={selected?.codes || []} onSelect={selectShape} />
              </MapBoundary>
              {unknown ? (
                <p className="mt-2 text-center text-xs text-ca-navy/50">
                  {unknown.orders} {unknown.orders === 1 ? "order has" : "orders have"} an unrecognised state and {unknown.orders === 1 ? "is" : "are"} counted as Unknown, not dropped.
                </p>
              ) : null}
            </div>
            <div className="min-w-0 lg:col-span-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ca-navy/45">State ranking</h3>
              {ranked.length === 0 ? (
                <p className="mt-2 text-sm text-ca-navy/55">No shipping rates available.</p>
              ) : (
                <ol className="mt-2 space-y-1">
                  {ranked.slice(0, 10).map((row, index) => {
                    const value = geoMetricValue(row, metric) ?? 0;
                    const active = selected?.codes.includes(row.code);
                    return (
                      <motion.li key={row.code} layout={!reduce} transition={reduce ? { duration: 0 } : { duration: 0.25, ease: "easeOut" }}>
                        <button
                          type="button"
                          onClick={() => selectState(row)}
                          aria-pressed={Boolean(active)}
                          className={`ca-focus block w-full rounded-lg px-2 py-1.5 text-left ${active ? "bg-[#fce9a8]/40" : "hover:bg-ca-navy/[0.03]"}`}
                        >
                          <span className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate text-[var(--ca-navy)]">
                              <span className="mr-2 tabular-nums text-ca-navy/35">{index + 1}</span>
                              <span className={row.code === "unknown" ? "text-ca-navy/55" : "font-semibold"}>{row.name}</span>
                            </span>
                            <span className="shrink-0 tabular-nums text-[var(--ca-navy)]">{metricText(row, metric)}</span>
                          </span>
                          <span className="mt-1 block h-1.5 rounded-full bg-ca-navy/[0.06]">
                            <motion.span
                              className={`block h-1.5 rounded-full ${row.code === "unknown" ? "bg-ca-navy/30" : metric === "shipping" ? "bg-[var(--ca-gold-dark)]" : "bg-[var(--ca-navy)]"}`}
                              initial={reduce ? false : { width: 0 }}
                              animate={{ width: `${Math.max(2, Math.round((value / max) * 100))}%` }}
                              transition={reduce ? { duration: 0 } : { duration: 0.35, ease: "easeOut" }}
                            />
                          </span>
                        </button>
                      </motion.li>
                    );
                  })}
                </ol>
              )}
              <button type="button" onClick={() => setShowAll((value) => !value)} className="mt-2 min-h-9 text-sm font-semibold text-[var(--ca-navy)]">
                {showAll ? "Hide state table" : `View all ${states.length} ${states.length === 1 ? "state" : "states"}`}
              </button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {selected ? (
              <motion.div
                key={selected.codes.join("+")}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.2 }}
                className="mt-4 rounded-xl border border-[#d4af37]/30 bg-[#fbf8f3] px-3 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-heading text-base font-bold text-[var(--ca-navy)]">{selected.label}</p>
                  <button type="button" onClick={() => setSelected(null)} className="min-h-9 text-sm font-semibold text-ca-navy/70 underline-offset-2 hover:underline">
                    Clear selection
                  </button>
                </div>
                {selectedRows.map((row) => (
                  <div key={row.code} className="mt-1 text-sm text-[var(--ca-navy)]">
                    {selectedRows.length > 1 ? <p className="text-[11px] font-semibold uppercase tracking-wide text-ca-navy/45">{row.name}</p> : null}
                    <p className="tabular-nums">
                      {row.orders} {row.orders === 1 ? "order" : "orders"} · {row.units} {row.units === 1 ? "unit" : "units"} · {formatPaise(row.revenuePaise)} revenue
                      {row.avgPaise != null ? ` · ${formatPaise(row.avgPaise)} avg booked shipping` : ""}
                    </p>
                    {row.subjectUnits.length ? <p className="text-ca-navy/65">{row.subjectUnits.map((item) => `${item.label} ${item.units}`).join(" · ")}</p> : null}
                    <p className="text-xs text-ca-navy/50">
                      {[
                        row.count > 1 && row.minPaise != null && row.maxPaise != null ? `Range ${formatPaise(row.minPaise)}–${formatPaise(row.maxPaise)}` : null,
                        row.topCourier ? `Top courier ${row.topCourier}` : null,
                        row.shipments > 0 ? `Rate coverage ${row.count} / ${row.shipments}` : null,
                        row.anomalies ? `${row.anomalies} rate ${row.anomalies === 1 ? "anomaly" : "anomalies"}` : null,
                      ].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                ))}
                {!detail && selectedRows.length === 0 ? <p className="mt-1 text-sm text-ca-navy/55">No paid orders in this period.</p> : null}
              </motion.div>
            ) : null}
          </AnimatePresence>

          {showAll ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm md:min-w-[52rem]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-ca-navy/45">
                    <th className="py-2 pr-3 font-semibold">
                      <button type="button" onClick={() => setSort((s) => ({ key: "name", desc: s.key === "name" ? !s.desc : false }))}>State</button>
                    </th>
                    {COLUMNS.map((col) => (
                      <th key={col.key} className={`py-2 pr-3 font-semibold ${col.wide ? "hidden md:table-cell" : ""}`} aria-sort={sort.key === col.key ? (sort.desc ? "descending" : "ascending") : "none"}>
                        <button type="button" onClick={() => setSort((s) => ({ key: col.key, desc: s.key === col.key ? !s.desc : true }))}>
                          {col.label}
                          {sort.key === col.key ? (sort.desc ? " ↓" : " ↑") : ""}
                        </button>
                      </th>
                    ))}
                    <th className="hidden py-2 pr-3 font-semibold md:table-cell">Top courier</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTable.map((row) => (
                    <tr key={row.code} className="border-t border-ca-navy/5">
                      <td className="py-2 pr-3 text-[var(--ca-navy)]">{row.name}</td>
                      {COLUMNS.map((col) => {
                        const value = row[col.key] as number | null;
                        return (
                          <td key={col.key} className={`py-2 pr-3 tabular-nums ${col.wide ? "hidden md:table-cell" : ""}`}>
                            {value == null ? "—" : col.money ? formatPaise(value) : col.key === "count" ? `${value} / ${row.shipments}` : value}
                          </td>
                        );
                      })}
                      <td className="hidden py-2 pr-3 text-ca-navy/70 md:table-cell">{row.topCourier || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="mt-5 border-t border-ca-navy/5 pt-4">
            <CityRanking
              cities={scopedCities}
              withShipping
              bare
              title={selected ? `Paid orders by city · ${selected.label}` : "Paid orders by city"}
            />
          </div>
        </>
      )}
    </section>
  );
}
