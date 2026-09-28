"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { formatPaise } from "@/lib/store/money";
import { rankCities, type CityMetric, type NotesCityRow } from "@/lib/analytics/notesVisuals";

const METRICS: Array<{ id: CityMetric; label: string }> = [
  { id: "orders", label: "Orders" },
  { id: "units", label: "Units" },
  { id: "revenue", label: "Revenue" },
];

function shareText(value: number | null): string {
  if (value == null) return "";
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}%`;
}

function metricValue(row: NotesCityRow, metric: CityMetric): string {
  if (metric === "revenue") return formatPaise(row.revenuePaise);
  if (metric === "units") return String(row.units);
  return String(row.orders);
}

export default function CityRanking({ cities }: { cities: NotesCityRow[] | null }) {
  const reduce = useReducedMotion();
  const [metric, setMetric] = useState<CityMetric>("orders");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ranked = useMemo(() => rankCities(cities || [], metric), [cities, metric]);
  const top = ranked[0];
  const hidden = Math.max(0, ranked.length - 8);

  return (
    <section className="rounded-2xl bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Paid orders by city</h2>
        <div className="flex rounded-full bg-[var(--ca-navy)]/5 p-1" role="tablist" aria-label="City ranking metric">
          {METRICS.map((item) => {
            const selected = metric === item.id;
            return (
              <button key={item.id} type="button" role="tab" aria-selected={selected} onClick={() => setMetric(item.id)} className={`min-h-9 rounded-full px-3 text-xs font-semibold ${selected ? "bg-[var(--ca-navy)] text-white" : "text-[var(--ca-navy)]/70"}`}>
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      {cities == null ? (
        <p className="mt-3 text-sm text-[var(--ca-navy)]/55">City breakdown is unavailable right now.</p>
      ) : ranked.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--ca-navy)]/55">No paid orders in this period.</p>
      ) : (
        <>
          {top && top.orders > 0 && (
            <p className="mt-3 text-sm text-[var(--ca-navy)]">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-navy)]/45">Top city </span>
              <span className="font-semibold">{top.city}</span>
              <span className="text-[var(--ca-navy)]/55"> · {top.orders} paid {top.orders === 1 ? "order" : "orders"}{metric === "orders" && top.sharePct != null ? ` · ${shareText(top.sharePct)}` : ""}</span>
            </p>
          )}
          <ol className="mt-3 space-y-2">
            {ranked.map((row, index) => {
              const max = Math.max(1, ...ranked.map((item) => metric === "revenue" ? item.revenuePaise : metric === "units" ? item.units : item.orders));
              const value = metric === "revenue" ? row.revenuePaise : metric === "units" ? row.units : row.orders;
              const width = `${Math.max(2, Math.round((value / max) * 100))}%`;
              if (index >= 8) return null;
              return (
                <li
                  key={`${row.city}|${row.state}`}
                  className={`min-w-0 ${index >= 5 ? "hidden md:block" : ""}`}
                  title={`${row.city}, ${row.state}. ${row.orders} paid orders, ${row.units} units, ${formatPaise(row.revenuePaise)}`}
                >
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <p className="min-w-0 truncate text-[var(--ca-navy)]">
                      <span className="mr-2 tabular-nums text-[var(--ca-navy)]/35">{index + 1}</span>
                      <span className="font-semibold">{row.city}</span>
                      <span className="ml-2 text-[var(--ca-navy)]/45">{row.state}</span>
                    </p>
                    <p className="shrink-0 tabular-nums text-[var(--ca-navy)]">
                      {metricValue(row, metric)}
                      {metric === "orders" && row.sharePct != null ? <span className="ml-2 text-[var(--ca-navy)]/40">{shareText(row.sharePct)}</span> : null}
                    </p>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-[var(--ca-navy)]/[0.06]">
                    <motion.div
                      className={`h-1.5 rounded-full ${row.city === "Unspecified" ? "bg-[var(--ca-navy)]/35" : "bg-[var(--ca-navy)]"}`}
                      initial={reduce ? false : { width: 0 }}
                      animate={{ width }}
                      transition={reduce ? { duration: 0 } : { duration: 0.35, ease: "easeOut" }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
          {ranked.length > 5 && (
            <button type="button" onClick={() => setOpen((value) => !value)} className="mt-3 text-sm font-semibold text-[var(--ca-navy)]">
              {open ? "Show top cities" : hidden > 0 ? `View all · ${hidden} more ${hidden === 1 ? "city" : "cities"}` : "View all cities"}
            </button>
          )}
          {open && (
            <div className="mt-3">
              {ranked.length > 10 && (
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search city" aria-label="Search city" className="mb-2 min-h-10 w-full rounded-full border border-[var(--ca-navy)]/10 px-3 text-sm" />
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">
                      {["City", "State", "Paid orders", "Units", "Revenue", "AOV"].map((header) => <th key={header} className="py-2 pr-3 font-semibold">{header}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.filter((row) => `${row.city} ${row.state}`.toLowerCase().includes(query.trim().toLowerCase())).map((row) => (
                      <tr key={`${row.city}|${row.state}`} className="border-t border-[var(--ca-navy)]/5">
                        <td className="py-2 pr-3 text-[var(--ca-navy)]">{row.city}</td>
                        <td className="py-2 pr-3 text-[var(--ca-navy)]/70">{row.state}</td>
                        <td className="py-2 pr-3 tabular-nums">{row.orders}</td>
                        <td className="py-2 pr-3 tabular-nums">{row.units}</td>
                        <td className="py-2 pr-3 tabular-nums">{formatPaise(row.revenuePaise)}</td>
                        <td className="py-2 pr-3 tabular-nums">{row.orders ? formatPaise(Math.round(row.revenuePaise / row.orders)) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
