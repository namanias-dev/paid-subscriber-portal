"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { INDIA_SHAPES, INDIA_VIEWBOX } from "./indiaShapes";
import { SHAPE_STATES, shapeLabel } from "@/lib/analytics/indiaStates";
import type { StateRow } from "@/lib/analytics/notesIntel";
import { formatPaise } from "@/lib/store/money";
import { geoMetricValue, mergeStateRows, type GeoMetric } from "@/lib/analytics/notesGeo";

const EMPTY_FILL = "#f3f1ec";
const NAVY_LOW = [226, 232, 240];
const NAVY_HIGH = [10, 26, 63];
const GOLD_LOW = [238, 241, 246];
const GOLD_HIGH = [154, 123, 47];

function mix(low: number[], high: number[], t: number): string {
  const clamp = Math.max(0, Math.min(1, t));
  const channel = (index: number) => Math.round(low[index] + (high[index] - low[index]) * clamp);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

export function TooltipRows({ row }: { row: StateRow }) {
  const lines: Array<[string, string]> = [
    ["Paid orders", String(row.orders)],
    ["Units", String(row.units)],
    ["Revenue", formatPaise(row.revenuePaise)],
  ];
  for (const subject of row.subjectUnits.slice(0, 4)) lines.push([subject.label, `${subject.units} ${subject.units === 1 ? "unit" : "units"}`]);
  if (row.avgPaise != null) lines.push(["Avg booked shipping", formatPaise(row.avgPaise)]);
  if (row.minPaise != null && row.count > 1) lines.push(["Min", formatPaise(row.minPaise)]);
  if (row.maxPaise != null && row.count > 1) lines.push(["Max", formatPaise(row.maxPaise)]);
  if (row.topCourier) lines.push(["Top courier", row.topCourier]);
  if (row.shipments > 0) lines.push(["Shipping-rate coverage", `${row.count} / ${row.shipments} orders`]);
  return (
    <dl className="mt-1 space-y-0.5">
      {lines.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className="text-[#0a1a3f]/55">{label}</dt>
          <dd className="tabular-nums font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function IndiaMap({
  states,
  metric,
  selectedCodes,
  onSelect,
}: {
  states: StateRow[];
  metric: GeoMetric;
  selectedCodes: string[];
  onSelect: (shapeId: string | null) => void;
}) {
  const reduce = useReducedMotion();
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ shape: string; x: number; y: number } | null>(null);
  const byCode = useMemo(() => new Map(states.map((row) => [row.code, row])), [states]);
  const shapeRows = useMemo(() => {
    const out = new Map<string, StateRow>();
    for (const shape of INDIA_SHAPES) {
      const rows = (SHAPE_STATES[shape.id] || []).map((code) => byCode.get(code)).filter((row): row is StateRow => Boolean(row));
      if (rows.length) out.set(shape.id, mergeStateRows(shapeLabel(shape.id), rows));
    }
    return out;
  }, [byCode]);
  const values = [...shapeRows.values()].map((row) => geoMetricValue(row, metric)).filter((value): value is number => value != null && value > 0);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const gold = metric === "shipping";
  const fillFor = (shapeId: string) => {
    const row = shapeRows.get(shapeId);
    const value = row ? geoMetricValue(row, metric) : null;
    if (value == null || value <= 0) return EMPTY_FILL;
    const t = gold ? (max === min ? 1 : (value - min) / (max - min)) : Math.sqrt(value / (max || 1));
    return gold ? mix(GOLD_LOW, GOLD_HIGH, 0.15 + t * 0.85) : mix(NAVY_LOW, NAVY_HIGH, 0.12 + t * 0.88);
  };
  const selectedShapes = new Set(INDIA_SHAPES.filter((shape) => (SHAPE_STATES[shape.id] || []).some((code) => selectedCodes.includes(code))).map((shape) => shape.id));
  const hoverRow = hover ? shapeRows.get(hover.shape) : null;
  const legend = (value: number) => (metric === "revenue" || metric === "shipping" ? formatPaise(value) : String(value));

  return (
    <div ref={wrap} className="relative">
      <svg viewBox={INDIA_VIEWBOX} className="mx-auto block h-auto w-full max-w-[460px]" role="group" aria-label="India map of paid Notes orders by state. The state ranking lists the same numbers.">
        {INDIA_SHAPES.map((shape) => {
          const row = shapeRows.get(shape.id);
          const selected = selectedShapes.has(shape.id);
          const label = row ? `${row.name}: ${row.orders} paid ${row.orders === 1 ? "order" : "orders"}, ${formatPaise(row.revenuePaise)}` : `${shapeLabel(shape.id)}: no paid orders`;
          return (
            <motion.path
              key={shape.id}
              d={shape.d}
              initial={false}
              animate={{ fill: fillFor(shape.id) }}
              transition={reduce ? { duration: 0 } : { duration: 0.35, ease: "easeOut" }}
              stroke={selected ? "#9a7b2f" : "#ffffff"}
              strokeWidth={selected ? 1.6 : 0.6}
              strokeLinejoin="round"
              className={`outline-none ${row ? "cursor-pointer hover:opacity-80 focus-visible:opacity-80" : ""}`}
              role={row ? "button" : "img"}
              tabIndex={row ? 0 : -1}
              aria-label={label}
              aria-pressed={row ? selected : undefined}
              onMouseMove={(event) => {
                if (!row || !wrap.current) return;
                const box = wrap.current.getBoundingClientRect();
                setHover({ shape: shape.id, x: event.clientX - box.left, y: event.clientY - box.top });
              }}
              onMouseLeave={() => setHover(null)}
              onClick={() => row && onSelect(selected ? null : shape.id)}
              onKeyDown={(event) => {
                if (!row || (event.key !== "Enter" && event.key !== " ")) return;
                event.preventDefault();
                onSelect(selected ? null : shape.id);
              }}
            />
          );
        })}
      </svg>
      <AnimatePresence>
        {hover && hoverRow ? (
          <motion.div
            key={hover.shape}
            className="pointer-events-none absolute z-10 hidden w-56 rounded-xl border border-[#0a1a3f]/10 bg-[#fbf8f3] px-3 py-2 text-xs text-[#0a1a3f] shadow-sm md:block"
            style={{ left: Math.min(hover.x + 14, (wrap.current?.clientWidth || 400) - 230), top: Math.max(0, hover.y - 20) }}
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.12 }}
          >
            <p className="font-semibold uppercase tracking-wide">{hoverRow.name}</p>
            <TooltipRows row={hoverRow} />
          </motion.div>
        ) : null}
      </AnimatePresence>
      {values.length > 0 ? (
        <div className="mx-auto mt-2 flex max-w-[260px] items-center gap-2 text-[10px] tabular-nums text-ca-navy/55" aria-hidden>
          <span>{legend(min)}</span>
          <span
            className="h-1.5 flex-1 rounded-full"
            style={{ background: gold ? `linear-gradient(90deg, ${mix(GOLD_LOW, GOLD_HIGH, 0.15)}, ${mix(GOLD_LOW, GOLD_HIGH, 1)})` : `linear-gradient(90deg, ${mix(NAVY_LOW, NAVY_HIGH, 0.12)}, ${mix(NAVY_LOW, NAVY_HIGH, 1)})` }}
          />
          <span>{legend(max)}</span>
        </div>
      ) : null}
    </div>
  );
}
