"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { formatINR } from "@/lib/dates";

function dayLabel(ymd: string): string {
  const parts = ymd.split("-");
  if (parts.length < 3) return ymd;
  return `${parts[2]}/${parts[1]}`;
}

const tipStyle = { borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 };

export function SparkArea({
  points,
  color = "#0057FF",
  height = 160,
  money = false,
  emptyLabel = "No data in this range.",
}: {
  points: { day: string; value: number }[];
  color?: string;
  height?: number;
  money?: boolean;
  emptyLabel?: string;
}) {
  if (!points.length) {
    return <div className="grid place-items-center text-sm text-muted" style={{ height }}>{emptyLabel}</div>;
  }
  const data = points.map((p) => ({ label: dayLabel(p.day), value: p.value, day: p.day }));
  const dense = data.length > 14;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id={`g-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={dense ? 3 : 0} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => (money ? (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)) : String(v))}
            width={40}
          />
          <Tooltip
            contentStyle={tipStyle}
            formatter={(v) => [money ? formatINR(Number(v)) : Number(v).toLocaleString("en-IN"), money ? "Amount" : "Count"]}
          />
          <Area type="monotone" dataKey="value" stroke={color} fill={`url(#g-${color.replace("#", "")})`} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MiniBars({
  points,
  color = "#0057FF",
  height = 160,
  money = false,
}: {
  points: { day: string; value: number }[];
  color?: string;
  height?: number;
  money?: boolean;
}) {
  if (!points.length) {
    return <div className="grid place-items-center text-sm text-muted" style={{ height }}>No data in this range.</div>;
  }
  const data = points.map((p) => ({ label: dayLabel(p.day), value: p.value, day: p.day }));
  const dense = data.length > 14;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={dense ? 3 : 0} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            contentStyle={tipStyle}
            formatter={(v) => [money ? formatINR(Number(v)) : Number(v).toLocaleString("en-IN"), money ? "Amount" : "Count"]}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.day} fill={d.value > 0 ? color : "#dbe3ff"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FunnelBars({
  stages,
  onStageClick,
}: {
  stages: { key: string; label: string; count: number }[];
  onStageClick?: (key: string) => void;
}) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="space-y-2.5">
      {stages.map((s, i) => {
        const pct = Math.round((s.count / max) * 100);
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onStageClick?.(s.key)}
            className="group w-full text-left"
          >
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-ink2 group-hover:text-primary">{s.label}</span>
              <span className="font-heading text-sm font-bold tabular-nums">{s.count.toLocaleString("en-IN")}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface2">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, #00205B 0%, #0057FF ${40 + i * 12}%, #C9A227 100%)`,
                }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}
