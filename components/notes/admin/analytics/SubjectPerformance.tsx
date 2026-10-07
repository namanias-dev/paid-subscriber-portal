"use client";

import { useMemo, useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import type { SubjectRow } from "@/lib/analytics/notesIntel";
import { formatPaise } from "@/lib/store/money";
import Sparkline from "./Sparkline";

type Rank = "revenue" | "orders" | "units";

const RANKS: Array<{ id: Rank; label: string }> = [
  { id: "revenue", label: "Revenue" },
  { id: "orders", label: "Orders" },
  { id: "units", label: "Units" },
];

function share(value: number | null): string {
  if (value == null) return "—";
  return `${Number.isInteger(value) ? value.toFixed(0) : value}%`;
}

function primary(row: SubjectRow, rank: Rank): { value: string; label: string } {
  if (rank === "orders") return { value: String(row.orders), label: row.orders === 1 ? "order" : "orders" };
  if (rank === "units") return { value: String(row.units), label: row.units === 1 ? "unit" : "units" };
  return { value: formatPaise(row.netRevenuePaise), label: "net product revenue" };
}

export default function SubjectPerformance({ subjects, totalMerchandisePaise }: { subjects: SubjectRow[] | null; totalMerchandisePaise: number | null }) {
  const reduce = useReducedMotion();
  const [rank, setRank] = useState<Rank>("revenue");
  const ranked = useMemo(() => {
    const value = (row: SubjectRow) => (rank === "orders" ? row.orders : rank === "units" ? row.units : row.netRevenuePaise);
    return [...(subjects || [])].sort((a, b) => value(b) - value(a) || b.netRevenuePaise - a.netRevenuePaise || a.label.localeCompare(b.label));
  }, [subjects, rank]);

  return (
    <section className="mt-4 rounded-2xl bg-white p-4" aria-labelledby="notes-subjects-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="notes-subjects-heading" className="font-heading text-lg font-bold text-[var(--ca-navy)]">Subject performance</h2>
          <p className="mt-1 text-sm text-ca-navy/55" title="Subject revenue excludes customer shipping. Order discounts are allocated across lines by value.">
            Orders paid in range · net product revenue excludes customer shipping
          </p>
        </div>
        <div className="flex rounded-full bg-ca-navy/5 p-1" role="tablist" aria-label="Rank subjects by">
          {RANKS.map((item) => {
            const selected = rank === item.id;
            return (
              <button key={item.id} type="button" role="tab" aria-selected={selected} onClick={() => setRank(item.id)} className={`min-h-9 rounded-full px-3 text-xs font-semibold ${selected ? "bg-[var(--ca-navy)] text-white" : "text-ca-navy/70"}`}>
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      {subjects == null ? (
        <p className="mt-3 text-sm text-ca-navy/55">Subject performance is unavailable right now.</p>
      ) : ranked.length === 0 ? (
        <p className="mt-3 text-sm text-ca-navy/55">No paid orders in this period.</p>
      ) : (
        <LayoutGroup>
          <ol className={`mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible md:pb-0 ${ranked.length >= 4 ? "xl:grid-cols-4" : ranked.length === 3 ? "xl:grid-cols-3" : ""}`}>
            {ranked.map((row, index) => {
              const main = primary(row, rank);
              return (
                <motion.li
                  key={row.key}
                  layout={!reduce}
                  transition={reduce ? { duration: 0 } : { type: "tween", duration: 0.3, ease: "easeOut" }}
                  className="w-[78%] shrink-0 snap-start rounded-xl border border-ca-navy/[0.07] bg-[#fbf8f3]/60 px-3 py-3 md:w-auto"
                  aria-label={`${index + 1}. ${row.label}: ${row.orders} orders, ${row.units} units, ${formatPaise(row.netRevenuePaise)} net product revenue`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-ca-navy/60">{row.label}</p>
                    <span className="shrink-0 text-[10px] font-semibold tabular-nums text-[var(--ca-gold-dark)]">#{index + 1}</span>
                  </div>
                  <p className="mt-1 font-heading text-xl font-bold tabular-nums text-[var(--ca-navy)]">{main.value}</p>
                  <p className="text-[11px] text-ca-navy/50">{main.label}</p>
                  <Sparkline points={row.spark} label={`${row.label} units over the period`} />
                  <dl className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1.5 border-t border-ca-navy/[0.06] pt-2">
                    {[
                      rank !== "orders" ? ["Orders", String(row.orders)] : null,
                      rank !== "units" ? ["Units", String(row.units)] : null,
                      rank !== "revenue" ? ["Revenue", formatPaise(row.netRevenuePaise)] : null,
                      ["Per order", row.avgNetPerOrderPaise == null ? "—" : formatPaise(row.avgNetPerOrderPaise)],
                      ["Unit share", share(row.unitSharePct)],
                      ["Rev. share", share(row.revenueSharePct)],
                    ]
                      .filter((cell): cell is string[] => Boolean(cell))
                      .map(([term, value]) => (
                        <div key={term} className="min-w-0">
                          <dt className="truncate text-[10px] uppercase tracking-wide text-ca-navy/45">{term}</dt>
                          <dd className="truncate text-xs font-semibold tabular-nums text-ca-navy">{value}</dd>
                        </div>
                      ))}
                  </dl>
                </motion.li>
              );
            })}
          </ol>
        </LayoutGroup>
      )}
      {subjects && subjects.length > 0 && totalMerchandisePaise != null ? (
        <p className="mt-2 text-xs text-ca-navy/45">
          Subject revenue totals {formatPaise(subjects.reduce((sum, row) => sum + row.netRevenuePaise, 0))}, which is captured merchandise after discounts and before customer shipping ({formatPaise(totalMerchandisePaise)}).
        </p>
      ) : null}
    </section>
  );
}
