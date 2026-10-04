"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { salesTooltipModel, type NotesPoint } from "@/lib/analytics/notesVisuals";
import { timelineSeries, type TimelineMetric, type TimelineMode, type TimelineRow } from "@/lib/analytics/notesTimeline";
import type { FulfillmentPoint } from "@/lib/analytics/notesIntel";
import { formatPaise } from "@/lib/store/money";

const SALES: Array<{ id: TimelineMetric; label: string }> = [
  { id: "orders", label: "Paid orders" },
  { id: "revenue", label: "Revenue" },
  { id: "units", label: "Units" },
];

const EVENTS: Array<{ id: TimelineMetric; label: string }> = [
  { id: "pickedUp", label: "Picked up" },
  { id: "shipped", label: "Shipped" },
  { id: "delivered", label: "Delivered" },
];

const EMPTY: Record<TimelineMetric, string> = {
  orders: "No paid orders in this period.",
  revenue: "No paid orders in this period.",
  units: "No paid orders in this period.",
  pickedUp: "No pickups in this period.",
  shipped: "No shipments in this period.",
  delivered: "No delivered orders in this period.",
};

const NAVY = "#0a1a3f";

function axisMoney(rupees: number): string {
  if (Math.abs(rupees) >= 100000) {
    const lakhs = rupees / 100000;
    const digits = lakhs >= 10 ? 0 : 1;
    return `₹${lakhs.toFixed(digits)}L`;
  }
  if (Math.abs(rupees) >= 1000) return `₹${(rupees / 1000).toFixed(rupees >= 10000 ? 0 : 1)}K`;
  return `₹${Math.round(rupees).toLocaleString("en-IN")}`;
}

function valueText(metric: TimelineMetric, value: number): string {
  return metric === "revenue" ? formatPaise(value) : String(value);
}

function TipShell({ title, rows }: { title: string; rows: Array<{ label: string; value: string }> }) {
  return (
    <div className="rounded-xl border border-[#0a1a3f]/10 bg-[#fbf8f3] px-3 py-2 text-xs text-[#0a1a3f] shadow-sm">
      <p className="font-semibold">{title}</p>
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

function makeTooltip(metric: TimelineMetric, mode: TimelineMode, metricLabel: string) {
  return function TimelineTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: TimelineRow }> }) {
    const row = payload?.[0]?.payload;
    if (!active || !row) return null;
    if (mode === "cumulative") {
      return (
        <TipShell
          title={row.label}
          rows={[
            { label: `${metricLabel} to date`, value: valueText(metric, row.valueRaw) },
            { label: "This period", value: valueText(metric, row.stepRaw) },
          ]}
        />
      );
    }
    if (row.sales && (metric === "orders" || metric === "revenue" || metric === "units")) {
      return <TipShell title={row.label} rows={salesTooltipModel(row.sales)} />;
    }
    return <TipShell title={row.label} rows={[{ label: metricLabel, value: valueText(metric, row.valueRaw) }]} />;
  };
}

export default function SalesTimeline({
  points,
  fulfillment,
  grain,
  subtitle,
}: {
  points: NotesPoint[];
  fulfillment?: FulfillmentPoint[] | null;
  grain: "hour" | "day";
  subtitle: string;
}) {
  const reduce = useReducedMotion();
  const [metric, setMetric] = useState<TimelineMetric>("orders");
  const [mode, setMode] = useState<TimelineMode>("daily");
  const metrics = fulfillment ? [...SALES, ...EVENTS] : SALES;
  const metricLabel = metrics.find((item) => item.id === metric)?.label || "Paid orders";
  const rows = useMemo(() => timelineSeries(points, fulfillment || null, metric, mode), [points, fulfillment, metric, mode]);
  const peak = rows.reduce((max, row) => Math.max(max, row.value), 0);
  const empty = rows.every((row) => row.stepRaw === 0);
  const tickInterval = grain === "hour" ? 0 : rows.length > 16 ? Math.ceil(rows.length / 6) - 1 : 0;
  const money = metric === "revenue";
  const Tip = useMemo(() => makeTooltip(metric, mode, metricLabel), [metric, mode, metricLabel]);
  const last = rows[rows.length - 1];
  const grainWord = grain === "hour" ? "Hourly" : "Daily";

  const xAxis = (
    <XAxis
      dataKey="key"
      tickFormatter={(key: string) => rows.find((row) => row.key === key)?.axis || ""}
      tick={{ fontSize: 10, fill: NAVY }}
      tickLine={false}
      axisLine={{ stroke: "rgba(10,26,63,0.12)" }}
      interval={tickInterval}
      minTickGap={8}
    />
  );
  const yAxis = (
    <YAxis
      width={money ? 48 : 30}
      allowDecimals={money}
      domain={[0, peak === 0 ? 1 : "auto"]}
      tick={{ fontSize: 10, fill: NAVY }}
      tickLine={false}
      axisLine={false}
      tickFormatter={money ? axisMoney : undefined}
    />
  );

  return (
    <section className="mt-4 rounded-2xl bg-white p-4" aria-label={`Sales over time, ${subtitle}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Sales over time</h2>
          <p className="mt-1 text-sm text-ca-navy/55">
            {subtitle}
            {fulfillment && EVENTS.some((item) => item.id === metric) ? " · fulfillment events by their own time" : ""}
          </p>
        </div>
        <div className="flex rounded-full bg-ca-navy/5 p-1" role="tablist" aria-label="Chart mode">
          {(["daily", "cumulative"] as const).map((id) => {
            const selected = mode === id;
            return (
              <button key={id} type="button" role="tab" aria-selected={selected} onClick={() => setMode(id)} className={`min-h-9 rounded-full px-3 text-xs font-semibold ${selected ? "bg-[var(--ca-navy)] text-white" : "text-ca-navy/70"}`}>
                {id === "daily" ? grainWord : "Cumulative"}
              </button>
            );
          })}
        </div>
      </div>
      <div className="-mx-1 mt-3 overflow-x-auto px-1 pb-1">
        <div className="flex w-max gap-1 rounded-full bg-ca-navy/5 p-1" role="tablist" aria-label="Sales metric">
          {metrics.map((item, index) => {
            const selected = metric === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setMetric(item.id)}
                className={`min-h-9 whitespace-nowrap rounded-full px-3 text-xs font-semibold ${selected ? "bg-[var(--ca-navy)] text-white" : "text-ca-navy/70"} ${index === SALES.length ? "ml-2" : ""}`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${mode}:${metric}`}
          className="relative mt-3 h-[240px] min-w-0"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
        >
          <ResponsiveContainer width="100%" height="100%">
            {mode === "daily" ? (
              <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={NAVY} strokeOpacity={0.06} />
                {xAxis}
                {yAxis}
                <Tooltip content={<Tip />} cursor={{ fill: "rgba(10,26,63,0.04)" }} />
                <Bar
                  dataKey="value"
                  fill={NAVY}
                  fillOpacity={0.82}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={22}
                  isAnimationActive={!reduce}
                  animationDuration={reduce ? 0 : 420}
                  activeBar={{ fill: NAVY, fillOpacity: 1 }}
                />
              </BarChart>
            ) : (
              <ComposedChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="notes-cumulative-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={NAVY} stopOpacity={0.12} />
                    <stop offset="100%" stopColor={NAVY} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={NAVY} strokeOpacity={0.05} />
                {xAxis}
                {yAxis}
                <Tooltip content={<Tip />} cursor={{ stroke: "rgba(10,26,63,0.18)", strokeWidth: 1 }} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="none"
                  fill="url(#notes-cumulative-fill)"
                  isAnimationActive={!reduce}
                  animationDuration={reduce ? 0 : 700}
                  animationEasing="ease-out"
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={NAVY}
                  strokeWidth={1.75}
                  dot={(props: { cx?: number; cy?: number; index?: number }) =>
                    props.index === rows.length - 1 && props.cx != null && props.cy != null ? (
                      <circle key="end" cx={props.cx} cy={props.cy} r={3.5} fill={NAVY} stroke="#fff" strokeWidth={1.5} />
                    ) : (
                      <g key={`d${props.index}`} />
                    )
                  }
                  activeDot={{ r: 3.5, fill: NAVY, stroke: "#fff", strokeWidth: 1.5 }}
                  isAnimationActive={!reduce}
                  animationDuration={reduce ? 0 : 800}
                  animationEasing="ease-out"
                />
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </motion.div>
      </AnimatePresence>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        {empty ? <p className="text-ca-navy/55">{EMPTY[metric]}</p> : <span />}
        {mode === "cumulative" && last && !empty ? (
          <p className="tabular-nums text-ca-navy/70">
            {metricLabel} to date <span className="font-semibold text-[var(--ca-navy)]">{valueText(metric, last.valueRaw)}</span>
          </p>
        ) : null}
      </div>
      <div className="sr-only">
      <table>
        <caption>Sales over time, {metricLabel}, {mode}, {subtitle}</caption>
        <thead>
          <tr>
            <th>When</th>
            <th>{metricLabel}{mode === "cumulative" ? " to date" : ""}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td>{valueText(metric, row.valueRaw)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}
