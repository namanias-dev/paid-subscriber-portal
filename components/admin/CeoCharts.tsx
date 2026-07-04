"use client";

// Recharts is a heavy dependency (~100 KB gzipped). These two trend charts sit
// BELOW the morning-glance scorecards, so we keep them in their own module and
// load it with next/dynamic (ssr:false) from CeoOverview — that way Recharts is
// dropped from the initial /admin bundle and only fetched once the data arrives.
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import { formatINR } from "@/lib/dates";

function dayLabel(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

export function RevenueTrend({ points }: { points: { day: string; revenue: number }[] }) {
  const chartData = points.map((p) => ({ label: dayLabel(p.day), day: p.day, revenue: p.revenue }));
  const dense = chartData.length > 14;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={dense ? 3 : 0} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
          <Tooltip cursor={{ fill: "rgba(0,87,255,0.06)" }} contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 }} formatter={(v) => [formatINR(Number(v)), "Revenue"]} />
          <Bar dataKey="revenue" radius={[4, 4, 0, 0]} fill="#0057FF">
            {chartData.map((d) => <Cell key={d.day} fill={d.revenue > 0 ? "#0057FF" : "#dbe3ff"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SuccessTrend({ points }: { points: { day: string; rate: number | null }[] }) {
  const chartData = points.map((p) => ({ label: dayLabel(p.day), day: p.day, rate: p.rate ?? 0, has: p.rate !== null }));
  const dense = chartData.length > 14;
  const hasAny = chartData.some((d) => d.has);
  if (!hasAny) return <div className="grid h-64 place-items-center text-sm text-muted">No payment attempts in this range.</div>;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={dense ? 3 : 0} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
          <Tooltip cursor={{ fill: "rgba(16,185,129,0.08)" }} contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 }} formatter={(v) => [`${Number(v)}%`, "Success rate"]} />
          <Bar dataKey="rate" radius={[4, 4, 0, 0]} fill="#10B981">
            {chartData.map((d) => <Cell key={d.day} fill={d.has ? "#10B981" : "#e5e7eb"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
