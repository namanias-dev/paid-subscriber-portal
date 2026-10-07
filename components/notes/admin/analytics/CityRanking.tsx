"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { formatPaise } from "@/lib/store/money";
import { rankCities, type CityMetric, type NotesCityRow } from "@/lib/analytics/notesVisuals";

type Metric = CityMetric | "shipping";

/** Base city row plus optional booked-shipping fields from the intelligence loader. */
export type CityRankingRow = NotesCityRow & { avgPaise?: number | null; count?: number; topCourier?: string | null };

const BASE: Array<{ id: Metric; label: string }> = [
  { id: "orders", label: "Orders" },
  { id: "units", label: "Units" },
  { id: "revenue", label: "Revenue" },
];

function shareText(value: number | null): string {
  if (value == null) return "";
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}%`;
}

function numeric(row: CityRankingRow, metric: Metric): number {
  if (metric === "shipping") return row.avgPaise ?? 0;
  if (metric === "revenue") return row.revenuePaise;
  if (metric === "units") return row.units;
  return row.orders;
}

function metricValue(row: CityRankingRow, metric: Metric): string {
  if (metric === "shipping") return row.avgPaise == null ? "—" : formatPaise(row.avgPaise);
  if (metric === "revenue") return formatPaise(row.revenuePaise);
  if (metric === "units") return String(row.units);
  return String(row.orders);
}

export default function CityRanking({
  cities,
  withShipping = false,
  title = "Paid orders by city",
  bare = false,
}: {
  cities: CityRankingRow[] | null;
  withShipping?: boolean;
  title?: string;
  /** Inside another card: no own surface. */
  bare?: boolean;
}) {
  const reduce = useReducedMotion();
  const [metric, setMetric] = useState<Metric>("orders");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const metrics = withShipping ? [...BASE, { id: "shipping" as const, label: "Avg shipping" }] : BASE;
  const ranked = useMemo(() => {
    const list = cities || [];
    if (metric !== "shipping") return rankCities(list, metric) as CityRankingRow[];
    return list.filter((row) => row.avgPaise != null).sort((a, b) => (b.avgPaise ?? 0) - (a.avgPaise ?? 0) || b.orders - a.orders);
  }, [cities, metric]);
  const top = ranked[0];
  const hidden = Math.max(0, ranked.length - 8);
  const max = Math.max(1, ...ranked.map((item) => numeric(item, metric)));

  return (
    <section className={bare ? "min-w-0" : "rounded-2xl bg-white p-4"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className={`font-heading font-bold text-[var(--ca-navy)] ${bare ? "text-base" : "text-lg"}`}>{title}</h2>
        <div className="-mx-1 max-w-full overflow-x-auto px-1">
          <div className="flex w-max rounded-full bg-ca-navy/5 p-1" role="tablist" aria-label="City ranking metric">
            {metrics.map((item) => {
              const selected = metric === item.id;
              return (
                <button key={item.id} type="button" role="tab" aria-selected={selected} onClick={() => setMetric(item.id)} className={`min-h-9 whitespace-nowrap rounded-full px-3 text-xs font-semibold ${selected ? "bg-[var(--ca-navy)] text-white" : "text-ca-navy/70"}`}>
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {cities == null ? (
        <p className="mt-3 text-sm text-ca-navy/55">City breakdown is unavailable right now.</p>
      ) : ranked.length === 0 ? (
        <p className="mt-3 text-sm text-ca-navy/55">{metric === "shipping" ? "No shipping rates available." : "No paid orders in this period."}</p>
      ) : (
        <>
          {top && top.orders > 0 && metric !== "shipping" && (
            <p className="mt-3 text-sm text-[var(--ca-navy)]">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ca-navy/45">Top city </span>
              <span className="font-semibold">{top.city}</span>
              <span className="text-ca-navy/55"> · {top.orders} paid {top.orders === 1 ? "order" : "orders"}{metric === "orders" && top.sharePct != null ? ` · ${shareText(top.sharePct)}` : ""}</span>
            </p>
          )}
          <ol className="mt-3 space-y-2">
            {ranked.map((row, index) => {
              const width = `${Math.max(2, Math.round((numeric(row, metric) / max) * 100))}%`;
              if (index >= 8) return null;
              const shipping = row.avgPaise != null ? `, avg booked shipping ${formatPaise(row.avgPaise)}` : "";
              return (
                <li
                  key={`${row.city}|${row.state}`}
                  className={`min-w-0 ${index >= 5 ? "hidden md:block" : ""}`}
                  title={`${row.city}, ${row.state}. ${row.orders} paid orders, ${row.units} units, ${formatPaise(row.revenuePaise)}${shipping}${row.topCourier ? `, top courier ${row.topCourier}` : ""}`}
                >
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <p className="min-w-0 truncate text-[var(--ca-navy)]">
                      <span className="mr-2 tabular-nums text-ca-navy/35">{index + 1}</span>
                      <span className="font-semibold">{row.city}</span>
                      <span className="ml-2 text-ca-navy/45">{row.state}</span>
                    </p>
                    <p className="shrink-0 tabular-nums text-[var(--ca-navy)]">
                      {metricValue(row, metric)}
                      {metric === "orders" && row.sharePct != null ? <span className="ml-2 text-ca-navy/40">{shareText(row.sharePct)}</span> : null}
                    </p>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-ca-navy/[0.06]">
                    <motion.div
                      className={`h-1.5 rounded-full ${row.city === "Unspecified" ? "bg-ca-navy/35" : metric === "shipping" ? "bg-[var(--ca-gold-dark)]" : "bg-[var(--ca-navy)]"}`}
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
            <button type="button" onClick={() => setOpen((value) => !value)} className="mt-3 min-h-9 text-sm font-semibold text-[var(--ca-navy)]">
              {open ? "Show top cities" : hidden > 0 ? `View all · ${hidden} more ${hidden === 1 ? "city" : "cities"}` : "View all cities"}
            </button>
          )}
          {open && (
            <div className="mt-3">
              {ranked.length > 10 && (
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search city" aria-label="Search city" className="mb-2 min-h-10 w-full rounded-full border border-ca-navy/10 px-3 text-sm" />
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-ca-navy/45">
                      {["City", "State", "Paid orders", "Units", "Revenue", "AOV", ...(withShipping ? ["Avg shipping", "Top courier"] : [])].map((header) => <th key={header} className="py-2 pr-3 font-semibold">{header}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.filter((row) => `${row.city} ${row.state}`.toLowerCase().includes(query.trim().toLowerCase())).map((row) => (
                      <tr key={`${row.city}|${row.state}`} className="border-t border-ca-navy/5">
                        <td className="py-2 pr-3 text-[var(--ca-navy)]">{row.city}</td>
                        <td className="py-2 pr-3 text-ca-navy/70">{row.state}</td>
                        <td className="py-2 pr-3 tabular-nums">{row.orders}</td>
                        <td className="py-2 pr-3 tabular-nums">{row.units}</td>
                        <td className="py-2 pr-3 tabular-nums">{formatPaise(row.revenuePaise)}</td>
                        <td className="py-2 pr-3 tabular-nums">{row.orders ? formatPaise(Math.round(row.revenuePaise / row.orders)) : "—"}</td>
                        {withShipping ? <td className="py-2 pr-3 tabular-nums">{row.avgPaise == null ? "—" : formatPaise(row.avgPaise)}</td> : null}
                        {withShipping ? <td className="py-2 pr-3 text-ca-navy/70">{row.topCourier || "—"}</td> : null}
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
