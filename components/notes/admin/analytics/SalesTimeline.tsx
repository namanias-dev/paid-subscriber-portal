"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { salesTooltipModel, type NotesPoint } from "@/lib/analytics/notesVisuals";

type Metric = "orders" | "revenue" | "units";

const METRICS: Array<{ id: Metric; label: string }> = [
  { id: "orders", label: "Paid orders" },
  { id: "revenue", label: "Revenue" },
  { id: "units", label: "Units" },
];

function axisMoney(rupees: number): string {
  if (Math.abs(rupees) >= 100000) {
    const lakhs = rupees / 100000;
    const digits = lakhs >= 10 ? 0 : 1;
    return `₹${lakhs.toFixed(digits)}L`;
  }
  return `₹${Math.round(rupees).toLocaleString("en-IN")}`;
}

function SalesTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: NotesPoint }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const rows = salesTooltipModel(point);
  return (
    <div className="rounded-xl border border-[#0a1a3f]/10 bg-[#fbf8f3] px-3 py-2 text-xs text-[#0a1a3f] shadow-sm">
      <p className="font-semibold">{point.label}</p>
      <dl className="mt-1 space-y-0.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-[#0a1a3f]/55">{row.label}</dt>
            <dd className="tabular-nums font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function SalesTimeline({ points, grain, subtitle }: { points: NotesPoint[]; grain: "hour" | "day"; subtitle: string }) {
  const reduce = useReducedMotion();
  const [metric, setMetric] = useState<Metric>("orders");
  const data = points.map((point) => ({
    ...point,
    value: metric === "revenue" ? point.revenuePaise / 100 : metric === "units" ? point.units : point.orders,
  }));
  const peak = data.reduce((max, point) => Math.max(max, point.value), 0);
  const empty = points.every((point) => point.orders === 0);
  const tickInterval = grain === "hour" ? 0 : points.length > 16 ? Math.ceil(points.length / 6) - 1 : 0;

  return (
    <section className="mt-4 rounded-2xl bg-white p-4" aria-label={`Sales over time, ${subtitle}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Sales over time</h2>
          <p className="mt-1 text-sm text-[var(--ca-navy)]/55">{subtitle}</p>
        </div>
        <div className="flex rounded-full bg-[var(--ca-navy)]/5 p-1" role="tablist" aria-label="Sales metric">
          {METRICS.map((item) => {
            const selected = metric === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setMetric(item.id)}
                className={`min-h-9 rounded-full px-3 text-xs font-semibold ${selected ? "bg-[var(--ca-navy)] text-white" : "text-[var(--ca-navy)]/70"}`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={metric}
          className="relative mt-3 h-[240px] min-w-0"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#0a1a3f" strokeOpacity={0.06} />
              <XAxis
                dataKey="key"
                tickFormatter={(key: string) => data.find((point) => point.key === key)?.axis || ""}
                tick={{ fontSize: 10, fill: "#0a1a3f" }}
                tickLine={false}
                axisLine={{ stroke: "rgba(10,26,63,0.12)" }}
                interval={tickInterval}
                minTickGap={8}
              />
              <YAxis
                width={metric === "revenue" ? 48 : 28}
                allowDecimals={metric === "revenue"}
                domain={[0, peak === 0 ? 1 : "auto"]}
                tick={{ fontSize: 10, fill: "#0a1a3f" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={metric === "revenue" ? axisMoney : undefined}
              />
              <Tooltip content={<SalesTooltip />} cursor={{ fill: "rgba(10,26,63,0.04)" }} />
              <Bar
                dataKey="value"
                fill="#0a1a3f"
                fillOpacity={0.82}
                radius={[3, 3, 0, 0]}
                maxBarSize={22}
                isAnimationActive={!reduce}
                animationDuration={reduce ? 0 : 420}
                activeBar={{ fill: "#0a1a3f", fillOpacity: 1 }}
              />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </AnimatePresence>
      {empty && <p className="mt-2 text-sm text-[var(--ca-navy)]/55">No paid orders in this period.</p>}
      <table className="sr-only">
        <caption>Sales over time, {METRICS.find((item) => item.id === metric)?.label}, {subtitle}</caption>
        <thead>
          <tr>
            <th>When</th>
            <th>Paid orders</th>
            <th>Paid units</th>
            <th>Revenue</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.key}>
              <td>{point.label}</td>
              <td>{point.orders}</td>
              <td>{point.units}</td>
              <td>{point.revenuePaise}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
