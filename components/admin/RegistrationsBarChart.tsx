"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";

/**
 * The Recharts bar chart body for {@link RegistrationsTrendPanel}, split into its
 * own module so it can be lazy-loaded via next/dynamic — this keeps Recharts out
 * of the initial bundle of every page that renders the (CSS-only) mini sparkline
 * card. Purely presentational; identical output to the previous inline chart.
 */
export default function RegistrationsBarChart({
  chartData,
  denseTicks,
}: {
  chartData: { label: string; ymd: string; count: number }[];
  denseTicks: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={denseTicks ? 2 : 0} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: "rgba(0,87,255,0.06)" }} contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 }} formatter={(v) => [`${v} registrations`, "Registrations"]} labelFormatter={(l) => `${l}`} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#0057FF">
          {chartData.map((d) => <Cell key={d.ymd} fill={d.count > 0 ? "#0057FF" : "#dbe3ff"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
